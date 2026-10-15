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
  getOrCreatePet,
  linkCode,
  performCareAction,
  publicServerStatus,
  renderGameCard,
  renderGithubProgress,
  replyMarkup,
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
          const parts = data.split(':');
          if (parts.length === 3) {
            const targetUid = parts[1];
            const action = parts[2];
            const senderUid = String(cqSender.id || '');

            if (targetUid !== senderUid) {
              if (cqId) {
                await callTelegramApi(
                  'answerCallbackQuery',
                  {
                    callback_query_id: cqId,
                    text: "This isn't your Fren! Use /game to spawn your own companion.",
                    show_alert: true,
                  },
                  token
                );
              }
              return reply.status(200).send({ ok: true });
            }

            let cardText: string;
            let cardKb: Record<string, unknown>;
            let toast: string;

            if (action === 'refresh') {
              const pet = getOrCreatePet(
                context.db,
                String(cqChatId),
                senderUid,
                String(cqSender.first_name || 'Fren')
              );
              const [renderedText, renderedKb] = renderGameCard(pet);
              cardText = renderedText;
              cardKb = renderedKb;
              toast = 'Refreshed Fren stats.';
            } else {
              const [pet, note] = performCareAction(context.db, String(cqChatId), senderUid, action);
              const [renderedText, renderedKb] = renderGameCard(pet, note);
              cardText = renderedText;
              cardKb = renderedKb;
              toast = note.split('\n')[0].slice(0, 100);
            }

            if (cqId) {
              await callTelegramApi(
                'answerCallbackQuery',
                { callback_query_id: cqId, text: toast },
                token
              );
            }
            if (cqChatId && cqMsgId) {
              await callTelegramApi(
                'editMessageText',
                {
                  chat_id: cqChatId,
                  message_id: cqMsgId,
                  text: cardText,
                  parse_mode: 'HTML',
                  reply_markup: cardKb,
                },
                token
              );
            }
            return reply.status(200).send({ ok: true });
          }
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

        const deployNotify = text.match(/^\/deploynotify(?:@\w+)?(?:\s+(off))?\s*$/i);
        if (deployNotify && chatId !== null && chatId !== undefined) {
          const owner = context.config.TELEGRAM_DEPLOY_OWNER.toLowerCase().replace(/^@/, '');
          const username = String(sender.username || '').toLowerCase().replace(/^@/, '');
          let responseText: string;
          if (chat?.type !== 'private') {
            responseText = 'Deployment notifications can only be registered in a private chat.';
          } else if (!owner || username !== owner) {
            responseText = 'This Telegram account cannot manage deployment notifications.';
          } else if (deployNotify[1]) {
            context.repos.telegram.unsubscribeDeployNotifications(String(chatId), Math.floor(context.now()));
            responseText = 'Website deployment notifications are off for this chat.';
          } else {
            context.repos.telegram.subscribeDeployNotifications(String(chatId), username, Math.floor(context.now()));
            responseText = "I'll DM this private chat after a website revision is verified live. Use /deploynotify off to stop notifications.";
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

        if (/^\/(?:game|pet|play)(?:@\w+)?\s*$/i.test(text) && chatId !== null && chatId !== undefined) {
          const pet = getOrCreatePet(
            context.db,
            String(chatId),
            String(sender.id || '0'),
            String(sender.first_name || 'Fren')
          );
          const [cardText, cardKeyboard] = renderGameCard(pet);
          await sendCommand({
            chat_id: chatId,
            text: cardText,
            parse_mode: 'HTML',
            reply_markup: cardKeyboard,
          });
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
          if (!canAccessAdminTools(sender, chat, groupAdmin)) {
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
          if (/^\/help(?:@\w+)?\s*$/i.test(text)) {
            const isPrivate = chat?.type === 'private';
            await sendCommand({
              chat_id: chatId,
              text: 'Talk to me normally, use /game to play with your fren, /progress for GitHub updates, /status for server health, or /show for your selected NFT. The site owner can use /deploynotify in a private chat. Group admins can also use /filter, /blocklist, and /ban.',
              reply_markup: replyMarkup(isPrivate ? `${miniapp}#pet` : deepLink, '🐾 Open TinyFrens', isPrivate),
            });
          } else {
            let answer: string;
            try {
              answer = await generateTelegramReply(
                chatHistory.get(String(chatId)) || [],
                context.config.GEMINI_API_KEY || context.config.GOOGLE_API_KEY,
                context.config.GEMINI_MODEL
              );
            } catch {
              answer = 'My AI brain is having trouble right now. Please try again in a moment.';
            }
            await sendCommand({ chat_id: chatId, text: answer });
          }
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
