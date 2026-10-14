import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AppContext } from '../context.js';
import { validateTelegramInitData } from '../crypto/signatures.js';
import {
  classify,
  adminServerTriage,
  canAccessAdminTools,
  fetchGithubProgress,
  getOrCreatePet,
  linkCode,
  performCareAction,
  publicServerStatus,
  renderGameCard,
  renderGithubProgress,
  replyMarkup,
  TG_API,
} from '../integrations/telegram.js';
import { readAccountProfile, telegramPet } from '../domain/account.js';
import { requestSync } from '../domain/device-sync.js';
import { isChatAdmin } from '../domain/telegram-moderation.js';

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

      const [kind, chatId, chat] = classify(update);

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

        const miniapp = process.env.TELEGRAM_MINI_APP_URL || context.config.TELEGRAM_MINIAPP_URL || 'https://tinyfrens.miono.live';
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
          const progress = await fetchGithubProgress(ownerPart, repoPart, context.config.GITHUB_TOKEN);
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
          const progress = await fetchGithubProgress(ownerPart, repoPart, context.config.GITHUB_TOKEN);
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
      }

      return reply.status(200).send({ ok: true });
    } catch (e) {
      return reply.status(400).send({ error: (e as Error).message });
    }
  });
}
