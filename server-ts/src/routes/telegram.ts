export function isTelegramDeployOwner(sender: Record<string, unknown>, ownerId: string | undefined): boolean {
  return Boolean(ownerId && String(sender.id ?? '') === ownerId);
}

import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AppContext } from '../context.js';
import { validateTelegramInitData } from '../crypto/signatures.js';
import {
  classify,
  adminServerTriage,
  canAccessAdminTools,
  chatMessage,
  fetchGithubProgress,
  generateTelegramReply,
  linkCode,
  publicServerStatus,
  renderGithubProgress,
  renderTelegramUpdateBriefing,
  replyMarkup,
  telegramHelpText,
  telegramHelpTopicRequest,
  telegramUpdateBriefingRequest,
  TG_API,
  TelegramChatEntry,
} from '../integrations/telegram.js';
import {
  createIssue,
  draftIssue,
  filterLabels,
  issueBody,
  labelsFromEnv,
  listLabels,
  parseRepo,
  responseSummary,
  transcript,
} from '../integrations/github.js';
import { readAccountProfile, telegramPet } from '../domain/account.js';
import { requestSync } from '../domain/device-sync.js';
import { isChatAdmin } from '../domain/telegram-moderation.js';
import { sendTelegramCompanion } from '../domain/telegram-companion.js';
import {
  getOpenScrapRun,
  joinScrapRun,
  renderScrapCard,
  resolveScrapRun,
  setScrapMessageId,
  startScrapRun,
} from '../domain/telegram-scrap.js';

async function callTelegramApi(
  method: string,
  payload: Record<string, unknown>,
  botToken: string
): Promise<void> {
  try {
    await fetch(`${TG_API}/bot${botToken}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    // Best-effort network call
  }
}

export function registerTelegramRoutes(app: FastifyInstance, context: AppContext): void {
  const chatHistory = new Map<string, TelegramChatEntry[]>();
  const historyLimit = Math.max(1, Math.min(200, context.config.TELEGRAM_ISSUE_HISTORY));
  const miniapp = context.config.TELEGRAM_MINIAPP_URL.split('#', 1)[0];
  const deepLink = context.config.TELEGRAM_MINIAPP_DEEP_LINK || 'https://t.me/TinyFrensBot?startapp=party';

  const remember = (chatId: unknown, entry: TelegramChatEntry) => {
    const key = String(chatId);
    const history = chatHistory.get(key) || [];
    history.push(entry);
    if (history.length > historyLimit) history.splice(0, history.length - historyLimit);
    chatHistory.set(key, history);
  };

  const fileIssueFromChat = async (
    chatId: unknown,
    chat: Record<string, unknown> | null,
    token: string
  ) => {
    const say = async (text: string) => {
      try {
        await context.telegramApi.call('sendMessage', { chat_id: chatId, text }, token);
      } catch {
        // Telegram delivery is best effort after the webhook has been accepted.
      }
    };
    try {
      context.rateLimiter.limit(`tg-issue:${String(chatId)}`, 5, 3600, context.now());
      const apiKey = context.config.GEMINI_API_KEY || context.config.GOOGLE_API_KEY;
      if (!apiKey) {
        await say("I have no AI key set, so I can't summarise the chat yet. (Set GEMINI_API_KEY.)");
        return;
      }
      if (!context.config.GITHUB_REPO) {
        await say("Issue filing isn't set up yet — the server needs GITHUB_TOKEN or a GitHub App, and GITHUB_REPO.");
        return;
      }
      const [owner, repo] = parseRepo(context.config.GITHUB_REPO);
      const githubToken = await context.githubAuth.token(owner, repo);
      if (!githubToken) {
        await say("Issue filing isn't set up yet — the server needs GITHUB_TOKEN or a GitHub App, and GITHUB_REPO.");
        return;
      }
      const messages = chatHistory.get(String(chatId)) || [];
      const lines = transcript(messages, historyLimit);
      if (!lines) {
        await say("I haven't seen enough of this conversation yet to write an issue. Say a bit about what's happening, then ask me again.");
        return;
      }
      await say(`📝 Reading the last ${Math.min(messages.length, historyLimit)} messages and drafting an issue…`);
      const draft = await draftIssue(lines, apiKey, String(chat?.title || ''), context.config.GEMINI_MODEL);
      const available = await listLabels(owner, repo, githubToken);
      const labels = filterLabels([...labelsFromEnv(context.config.GITHUB_ISSUE_LABELS), ...draft.labels], available);
      const footer = `_Filed from Telegram chat \`${String(chatId)}\` by the TinyFrens bot, summarising ${messages.length} recent message(s). Please edit if the summary missed something._`;
      const created = await createIssue(owner, repo, githubToken, draft.title, issueBody(draft, footer), labels);
      const result = responseSummary(created.data, created.status, owner, repo);
      if (!result.ok) {
        await say(`I couldn't open the issue: ${result.error}`);
        return;
      }
      context.repos.telegram.linkChatToIssue(result.repo, result.number, String(chatId));
      await say(`✅ Opened issue #${result.number}: ${result.title}\n${result.url}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      const safeError = message === 'Please wait before trying again' ||
        message.startsWith('GITHUB_REPO ') ||
        message.startsWith('The model ') ||
        message === 'No issue to file from this conversation' ||
        message === 'No recent conversation to summarise';
      if (safeError) {
        await say(`I couldn't file that issue: ${message}`);
      } else {
        await say('Something went wrong while filing that issue. Please try again.');
      }
    }
  };

  app.post('/api/telegram/auth', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const token = context.config.TELEGRAM_BOT_TOKEN;
      if (!token) {
        return reply.status(503).send({ error: 'Telegram bot is not configured' });
      }

      const body = (request.body || {}) as Record<string, unknown>;
      const initData = String(body.initData || '');
      const data = validateTelegramInitData(initData, token, 86400, context.now());
      const user = data.user;
      if (!user || !user.id) {
        return reply.status(400).send({ error: 'No Telegram user in initData' });
      }

      const pet = telegramPet(context, user as unknown as Record<string, unknown>, true);
      const profile = readAccountProfile(context, pet.id);

      return reply.status(200).send({
        id: pet.id,
        token: pet.token,
        code: pet.code,
        chat: data.chat,
        chatInstance: data.chat_instance,
        startParam: data.start_param,
        profile,
      });
    } catch (e) {
      return reply.status(400).send({ error: (e as Error).message || 'Telegram sign-in failed' });
    }
  });

  app.post('/api/telegram/webhook', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const token = context.config.TELEGRAM_BOT_TOKEN;
      if (!token) {
        return reply.status(503).send({ error: 'Telegram support is unavailable' });
      }

      const secret = context.config.TELEGRAM_WEBHOOK_SECRET;
      if (secret) {
        const headerSecret = request.headers['x-telegram-bot-api-secret-token'];
        if (headerSecret !== secret) {
          reply.header('Content-Type', 'text/plain; charset=utf-8');
          return reply.status(403).send('Telegram webhook secret did not match');
        }
      }

      const update = request.body;
      if (!update || typeof update !== 'object') {
        return reply.status(200).send({ ok: true });
      }

      if (await context.telegramModeration.handleUpdate(update)) {
        return reply.status(200).send({ ok: true });
      }

      const [kind, chatId, chat] = classify(update, context.config.TELEGRAM_BOT_USERNAME);

      const syncCode = linkCode(update);
      if (syncCode && chatId !== null && chatId !== undefined) {
        if (!secret) {
          return reply.status(503).send({ error: 'Telegram webhook secret is required' });
        }
        const msg = (update as Record<string, unknown>).message as Record<string, unknown> | undefined;
        const sender = (msg?.from && typeof msg.from === 'object') ? (msg.from as Record<string, unknown>) : {};
        const pet = telegramPet(context, sender);
        const username = sender.username ? String(sender.username) : '';
        const label = username ? `Telegram @${username}` : 'Telegram Mini App';
        requestSync(context, pet.id, syncCode, label);

        const miniapp = context.config.TELEGRAM_MINIAPP_URL;
        await callTelegramApi(
          'sendMessage',
          {
            chat_id: chatId,
            text: 'Link requested. Approve it on the TinyFrens device that made the code, then open TinyFrens here.',
            reply_markup: replyMarkup(`${miniapp}#settings`, '🐾 Open linked account', true),
          },
          token
        );
        return reply.status(200).send({ ok: true });
      }

      if (kind === 'callback_query') {
        const cq = (update as Record<string, unknown>).callback_query as Record<string, unknown>;
        const cqId = cq.id as string | undefined;
        const data = String(cq.data || '');
        const cqMsg = (cq.message && typeof cq.message === 'object') ? (cq.message as Record<string, unknown>) : {};
        const cqSender = (cq.from && typeof cq.from === 'object') ? (cq.from as Record<string, unknown>) : {};
        const cqChat = (cqMsg.chat && typeof cqMsg.chat === 'object') ? (cqMsg.chat as Record<string, unknown>) : chat;
        const cqChatId = cqChat?.id ?? chatId;
        const cqMsgId = cqMsg.message_id as number | undefined;

        if (data.startsWith('g:')) {
          if (cqId) {
            await context.telegramApi.call('answerCallbackQuery', {
              callback_query_id: cqId,
              text: 'This version has ended. Start the new group game with /game.',
              show_alert: true,
            }, token);
          }
          if (cqChatId && cqMsgId) {
            await context.telegramApi.call('editMessageText', {
              chat_id: cqChatId,
              message_id: cqMsgId,
              text: '🎮 <b>TinyFrens Group Game</b>\n\nThis card has retired. Send /game in the group to start a new run.',
              parse_mode: 'HTML',
              reply_markup: { inline_keyboard: [] },
            }, token);
          }
          return reply.status(200).send({ ok: true });
        } else if (data === 'game:new') {
          const senderUid = String(cqSender.id || '0');
          const now = Math.floor(context.now());
          const existing = cqChatId ? getOpenScrapRun(context.db, String(cqChatId)) : undefined;
          if (!cqChatId || !cqMsgId) {
            if (cqId) {
              await context.telegramApi.call('answerCallbackQuery', {
                callback_query_id: cqId,
                text: 'Start the next run from the group.',
                show_alert: true,
              }, token);
            }
            return reply.status(200).send({ ok: true });
          }
          if (existing && existing.run.message_id !== cqMsgId) {
            if (cqId) {
              await context.telegramApi.call('answerCallbackQuery', {
                callback_query_id: cqId,
                text: 'A scrap run is already open. Use /game to find it.',
                show_alert: true,
              }, token);
            }
            return reply.status(200).send({ ok: true });
          }
          const senderPet = telegramPet(context, cqSender);
          const started = existing
            ? { state: existing, created: false }
            : startScrapRun(
                context.db,
                String(cqChatId),
                senderUid,
                senderPet.id,
                String(cqSender.first_name || cqSender.username || 'Fren'),
                now,
                context.random()
              );
          if (started.created) setScrapMessageId(context.db, started.state.run.id, cqMsgId);
          const [scrapText, scrapKeyboard] = renderScrapCard(started.state, now);
          await context.telegramApi.call('editMessageText', {
            chat_id: cqChatId,
            message_id: cqMsgId,
            text: scrapText,
            parse_mode: 'HTML',
            reply_markup: scrapKeyboard,
          }, token);
          if (cqId) {
            await context.telegramApi.call('answerCallbackQuery', {
              callback_query_id: cqId,
              text: started.created ? 'New scrap run opened.' : 'Scrap run refreshed.',
            }, token);
          }
          return reply.status(200).send({ ok: true });
        } else if (data.startsWith('game:') || data.startsWith('scrap:')) {
          const parts = data.split(':');
          const runId = parts[1] || '';
          const action = parts[2] || '';
          const senderUid = String(cqSender.id || '');
          const senderName = String(cqSender.first_name || cqSender.username || 'Fren');
          const now = Math.floor(context.now());
          const result = action === 'join'
            ? joinScrapRun(
                context.db,
                runId,
                senderUid,
                telegramPet(context, cqSender).id,
                senderName,
                now
              )
            : action === 'resolve'
              ? resolveScrapRun(
                  context.db,
                  runId,
                  senderUid,
                  now,
                  context.random(),
                  (petId, credits, scrapRunId) => {
                    context.economy.grant(petId, credits, 'telegram-scrap', 'scrap-run', scrapRunId);
                  }
                )
              : { ok: false as const, reason: 'missing' as const };

          let toast = 'That scrap run is no longer available.';
          let showAlert = false;
          if (!result.ok) {
            if (result.reason === 'full') toast = 'That crew is full or its join window has closed.';
            if (result.reason === 'not-member') toast = 'Join the crew before resolving its run.';
            if (result.reason === 'waiting') toast = `Crew is still open for ${result.waitSeconds || 1}s.`;
            showAlert = result.reason !== 'waiting';
          } else {
            toast = action === 'join'
              ? (result.changed ? 'You joined the crew.' : 'You are already in this crew.')
              : (result.changed ? 'The crew found scrap!' : 'This run is already complete.');
            if (cqChatId && cqMsgId) {
              const [scrapText, scrapKeyboard] = renderScrapCard(result.state, now);
              await context.telegramApi.call('editMessageText', {
                chat_id: cqChatId,
                message_id: cqMsgId,
                text: scrapText,
                parse_mode: 'HTML',
                reply_markup: scrapKeyboard,
              }, token);
            }
          }
          if (cqId) {
            await context.telegramApi.call('answerCallbackQuery', {
              callback_query_id: cqId,
              text: toast,
              show_alert: showAlert,
            }, token);
          }
          return reply.status(200).send({ ok: true });
        } else if (data === 'gh:refresh') {
          const repoStr = context.config.GITHUB_REPO || 'dutchiono/TinyFrens';
          const [ownerPart, repoPart] = repoStr.includes('/') ? repoStr.split('/', 2) : ['dutchiono', 'TinyFrens'];
          const progress = await fetchGithubProgress(ownerPart, repoPart, await context.githubAuth.token(ownerPart, repoPart));
          const [ghText, ghKb] = renderGithubProgress(progress, repoPart);
          if (cqId) {
            await callTelegramApi(
              'answerCallbackQuery',
              { callback_query_id: cqId, text: 'Refreshed latest development progress.' },
              token
            );
          }
          if (cqChatId && cqMsgId) {
            await callTelegramApi(
              'editMessageText',
              {
                chat_id: cqChatId,
                message_id: cqMsgId,
                text: ghText,
                parse_mode: 'HTML',
                reply_markup: ghKb,
              },
              token
            );
          }
          return reply.status(200).send({ ok: true });
        } else if (data === 'status:refresh') {
          const uptime = Math.floor(context.now() - context.startTime);
          const [stText, stKb] = publicServerStatus(0, uptime);
          if (cqId) {
            await callTelegramApi(
              'answerCallbackQuery',
              { callback_query_id: cqId, text: 'Refreshed server status.' },
              token
            );
          }
          if (cqChatId && cqMsgId) {
            await callTelegramApi(
              'editMessageText',
              {
                chat_id: cqChatId,
                message_id: cqMsgId,
                text: stText,
                parse_mode: 'HTML',
                reply_markup: stKb,
              },
              token
            );
          }
          return reply.status(200).send({ ok: true });
        }

        if (cqId) {
          await callTelegramApi('answerCallbackQuery', { callback_query_id: cqId }, token);
        }
        return reply.status(200).send({ ok: true });
      }

      const message = (update as Record<string, unknown>).message;
      if (message && typeof message === 'object') {
        const telegramMessage = message as Record<string, unknown>;
        if (await context.telegramModeration.handleManagement(
          telegramMessage,
          chat
        )) {
          return reply.status(200).send({ ok: true });
        }
        const text = String(telegramMessage.text || '');
        const sender = telegramMessage.from && typeof telegramMessage.from === 'object'
          ? telegramMessage.from as Record<string, unknown>
          : {};
        const messageId = telegramMessage.message_id;
        const sendCommand = async (payload: Record<string, unknown>) => {
          if (messageId) payload.reply_to_message_id = messageId;
          await context.telegramApi.call('sendMessage', payload, token);
        };

        // Built-in commands must work even if the AI provider is unavailable.
        if (/^\/myid(?:@\w+)?\s*$/i.test(text) && chatId !== null && chatId !== undefined) {
          const userId = String(sender.id || '');
          if (!/^\d+$/.test(userId)) return reply.status(200).send({ ok: true });
          const isPrivate = chat?.type === 'private';
          await sendCommand({
            chat_id: chatId,
            text: isPrivate
              ? `Your Telegram user ID: <code>${userId}</code>\n\nCopy that number into the TinyFrens deployment-owner configuration. It is not a password.`
              : 'For your privacy, DM @TinyFrensBot and send /myid there. Your ID will not be posted in this group.',
            parse_mode: 'HTML',
          });
          return reply.status(200).send({ ok: true });
        }

        const requestedHelp = telegramHelpTopicRequest(text, context.config.TELEGRAM_BOT_USERNAME);
        if (requestedHelp && /^\/(?:help|gamehelp|showhelp)(?:@\w+)?\s*$/i.test(text) && chatId !== null && chatId !== undefined) {
          const isPrivate = chat?.type === 'private';
          await sendCommand({
            chat_id: chatId,
            parse_mode: 'HTML',
            text: telegramHelpText(requestedHelp),
            reply_markup: replyMarkup(isPrivate ? `${miniapp}#pet` : deepLink, '🐾 Open TinyFrens', isPrivate),
          });
          return reply.status(200).send({ ok: true });
        }

        const deployNotify = text.match(/^\/deploynotify(?:@\w+)?(?:\s+(off))?\s*$/i);
        if (deployNotify && chatId !== null && chatId !== undefined) {
          const ownerId = context.config.TELEGRAM_DEPLOY_OWNER_ID;
          const username = String(sender.username || '').toLowerCase().replace(/^@/, '');
          const authorized = isTelegramDeployOwner(sender, ownerId);
          let responseText: string;
          if (!authorized) {
            responseText = 'This Telegram account cannot manage deployment notifications.';
          } else if (!['private', 'group', 'supergroup'].includes(String(chat?.type || ''))) {
            responseText = 'Deployment notifications can only be registered in a DM or group.';
          } else if (deployNotify[1]) {
            context.repos.telegram.unsubscribeDeployNotifications(String(chatId), Math.floor(context.now()));
            responseText = 'Website deployment notifications are off for this chat.';
          } else {
            context.repos.telegram.subscribeDeployNotifications(String(chatId), username || ownerId || '', Math.floor(context.now()));
            responseText = `I'll notify this ${chat?.type === 'private' ? 'DM' : 'group'} after a website revision is verified live. Use /deploynotify off to stop notifications.`;
          }
          await sendCommand({ chat_id: chatId, text: responseText });
          return reply.status(200).send({ ok: true });
        }

        const show = text.match(/^\/show(?:@\w+)?(?:\s+([1-5]))?\s*$/i);
        if (show && chatId !== null && chatId !== undefined) {
          if (!secret) return reply.status(503).send({ error: 'Telegram webhook secret is required' });
          const pet = telegramPet(context, sender);
          const isPrivate = chat?.type === 'private';
          try {
            await sendTelegramCompanion(context, chatId, pet.id, Number(show[1] || 1), token, isPrivate);
          } catch (error) {
            await sendCommand({
              chat_id: chatId,
              text: error instanceof Error ? error.message : 'TinyFrens could not verify that NFT right now',
              reply_markup: replyMarkup(isPrivate ? `${miniapp}#pet` : deepLink, '🐾 Open TinyFrens', isPrivate),
            });
          }
          return reply.status(200).send({ ok: true });
        }

        const isGroupChat = chat?.type === 'group' || chat?.type === 'supergroup';
        if (/^\/(?:scrap|pet|play)(?:@\w+)?\s*$/i.test(text) && chatId !== null && chatId !== undefined) {
          await sendCommand({ chat_id: chatId, text: 'Use /game — it is the one TinyFrens group game.' });
          return reply.status(200).send({ ok: true });
        }

        if (/^\/game(?:@\w+)?\s*$/i.test(text) && chatId !== null && chatId !== undefined) {
          if (!isGroupChat) {
            await sendCommand({ chat_id: chatId, text: 'Add TinyFrensBot to a group, then send /game there to start a run.' });
            return reply.status(200).send({ ok: true });
          }
          const cid = String(chatId);
          const uid = String(sender.id || '0');
          const senderPet = telegramPet(context, sender);
          const now = Math.floor(context.now());
          const existing = getOpenScrapRun(context.db, cid);
          const started = existing
            ? { state: existing, created: false }
            : startScrapRun(
                context.db,
                cid,
                uid,
                senderPet.id,
                String(sender.first_name || sender.username || 'Fren'),
                now,
                context.random()
              );
          const [scrapText, scrapKeyboard] = renderScrapCard(started.state, now);
          const previousCardId = started.state.run.message_id;
          let cardVisible = false;
          if (!started.created && previousCardId && now <= started.state.run.join_until) {
            const edited = await context.telegramApi.call('editMessageText', {
              chat_id: chatId,
              message_id: previousCardId,
              text: scrapText,
              parse_mode: 'HTML',
              reply_markup: scrapKeyboard,
            }, token);
            const description = String(edited.data?.description || '');
            cardVisible = (edited.status < 400 && edited.data?.ok === true) ||
              /message is not modified/i.test(description);
          }
          if (!cardVisible) {
            const sent = await context.telegramApi.call('sendMessage', {
              chat_id: chatId,
              text: scrapText,
              parse_mode: 'HTML',
              reply_markup: scrapKeyboard,
              reply_to_message_id: messageId,
            }, token);
            const result = sent.data?.result;
            const sentMessageId = result && typeof result === 'object'
              ? Number((result as Record<string, unknown>).message_id)
              : 0;
            cardVisible = sent.status < 400 && sent.data?.ok === true && sentMessageId > 0;
            if (cardVisible) {
              setScrapMessageId(context.db, started.state.run.id, sentMessageId);
              if (previousCardId && previousCardId !== sentMessageId) {
                await context.telegramApi.call('deleteMessage', {
                  chat_id: chatId,
                  message_id: previousCardId,
                }, token);
              }
            }
          }
          if (cardVisible && messageId) {
            try {
              await context.telegramApi.call('deleteMessage', {
                chat_id: chatId,
                message_id: messageId,
              }, token);
            } catch {
              // Cleanup is optional; the scrap run remains playable if Telegram rejects deletion.
            }
          }
          return reply.status(200).send({ ok: true });
        }

        if (/^\/(?:progress|github|work)(?:@\w+)?\s*$/i.test(text) && chatId !== null && chatId !== undefined) {
          const repoStr = context.config.GITHUB_REPO || 'dutchiono/TinyFrens';
          const [ownerPart, repoPart] = repoStr.includes('/') ? repoStr.split('/', 2) : ['dutchiono', 'TinyFrens'];
          const progress = await fetchGithubProgress(ownerPart, repoPart, await context.githubAuth.token(ownerPart, repoPart));
          const [progressText, progressKeyboard] = renderGithubProgress(progress, repoPart);
          await sendCommand({
            chat_id: chatId,
            text: progressText,
            parse_mode: 'HTML',
            reply_markup: progressKeyboard,
          });
          return reply.status(200).send({ ok: true });
        }

        if (/^\/status(?:@\w+)?\s*$/i.test(text) && chatId !== null && chatId !== undefined) {
          const [statusText, statusKeyboard] = publicServerStatus(0, Math.floor(context.now() - context.startTime));
          await sendCommand({
            chat_id: chatId,
            text: statusText,
            parse_mode: 'HTML',
            reply_markup: statusKeyboard,
          });
          return reply.status(200).send({ ok: true });
        }

        if (/^\/(?:admin|server|triage)(?:@\w+)?\s*$/i.test(text) && chatId !== null && chatId !== undefined) {
          const groupAdmin = chat
            ? await isChatAdmin(context.telegramApi, chat, sender, token, telegramMessage)
            : false;
          if (!canAccessAdminTools(sender, chat, groupAdmin, context.config.TELEGRAM_DEPLOY_OWNER_ID)) {
            await sendCommand({
              chat_id: chatId,
              text: '🔒 Access Denied: Server triage and administrative diagnostics are restricted to @dutchiono.',
            });
            return reply.status(200).send({ ok: true });
          }
          await sendCommand({
            chat_id: chatId,
            text: adminServerTriage(context.db, 0, Math.floor(context.now() - context.startTime)),
            parse_mode: 'HTML',
          });
          return reply.status(200).send({ ok: true });
        }

        if (await context.telegramModeration.handleContent(
          telegramMessage,
          chat
        )) {
          return reply.status(200).send({ ok: true });
        }

        if ((kind === 'message' || kind === 'mention') && chatId !== null && chatId !== undefined) {
          const entry = chatMessage(update);
          if (entry) remember(chatId, entry);
        }

        if (kind === 'start' && chatId !== null && chatId !== undefined) {
          const startPayload = text.split(/\s+/, 2)[1]?.trim().toLowerCase() || '';
          const intro = startPayload === 'link'
            ? 'Copy a sync code from TinyFrens Settings, then send /link CODE here. Approve the request on the device that made the code.'
            : 'Bring your NFTs into TinyFrens. Open the Mini App below. If you already use TinyFrens elsewhere, link this Telegram account from Settings.';
          await context.telegramApi.call('sendMessage', { chat_id: chatId, text: intro }, token);
          await context.telegramApi.call('sendMessage', {
            chat_id: chatId,
            text: 'Ready when you are.',
            reply_markup: replyMarkup(`${miniapp}${startPayload === 'link' ? '#settings' : '#pet'}`),
          }, token);
          return reply.status(200).send({ ok: true });
        }

        if (kind === 'issue' && chatId !== null && chatId !== undefined) {
          const replied = telegramMessage.reply_to_message;
          const entry = chatMessage({ message: replied });
          if (entry) {
            const history = chatHistory.get(String(chatId));
            if (!history || history.at(-1)?.name !== entry.name || history.at(-1)?.text !== entry.text) {
              remember(chatId, entry);
            }
          }
          await fileIssueFromChat(chatId, chat, token);
          return reply.status(200).send({ ok: true });
        }

        if (kind === 'mention' && chatId !== null && chatId !== undefined) {
          context.rateLimiter.limit(`tg-mention:${String(chatId)}`, 30, 3600, context.now());
          let answer: string;
          const briefing = telegramUpdateBriefingRequest(text, context.config.TELEGRAM_BOT_USERNAME);
          const helpTopic = telegramHelpTopicRequest(text, context.config.TELEGRAM_BOT_USERNAME);
          if (helpTopic) {
            answer = telegramHelpText(helpTopic);
          } else if (briefing) {
            const repoStr = context.config.GITHUB_REPO || 'dutchiono/TinyFrens';
            const [ownerPart, repoPart] = repoStr.includes('/') ? repoStr.split('/', 2) : ['dutchiono', 'TinyFrens'];
            const progress = await fetchGithubProgress(
              ownerPart,
              repoPart,
              await context.githubAuth.token(ownerPart, repoPart),
              fetch,
              context.now
            );
            answer = renderTelegramUpdateBriefing(
              progress,
              briefing.target,
              repoPart,
              briefing.hours,
              Math.floor(context.now())
            );
          } else {
            try {
              answer = await generateTelegramReply(
                chatHistory.get(String(chatId)) || [],
                context.config.GEMINI_API_KEY || context.config.GOOGLE_API_KEY,
                context.config.GEMINI_MODEL
              );
            } catch {
              answer = 'AI chat is unavailable right now. /help, /game, /show, and /status still work.';
            }
          }
          await sendCommand({
            chat_id: chatId,
            text: answer,
            ...(helpTopic ? { parse_mode: 'HTML' } : {}),
          });
          return reply.status(200).send({ ok: true });
        }
      }

      if (kind === 'added' && chatId !== null && chatId !== undefined) {
        const title = String(chat?.title || 'this chat');
        await context.telegramApi.call('sendMessage', {
          chat_id: chatId,
          text: `TinyFrens is ready in ${title}. Open it to bring an NFT into the room, then use /show to post your selected companion.`,
          reply_markup: replyMarkup(deepLink, '🐾 Open TinyFrens', false),
        }, token);
      }

      return reply.status(200).send({ ok: true });
    } catch (e) {
      return reply.status(400).send({ error: (e as Error).message });
    }
  });
}
