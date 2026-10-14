import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AppContext } from '../context.js';
import { validateTelegramInitData } from '../crypto/signatures.js';
import {
  classify,
  getOrCreatePet,
  performCareAction,
  publicServerStatus,
  renderGameCard,
  renderGithubProgress,
  TG_API,
} from '../integrations/telegram.js';
import { readAccountProfile, telegramPet } from '../domain/account.js';

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

      const [kind, chatId, chat] = classify(update);

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
          const repoPart = repoStr.includes('/') ? repoStr.split('/')[1] : 'TinyFrens';
          const [ghText, ghKb] = renderGithubProgress({}, repoPart);
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

      return reply.status(200).send({ ok: true });
    } catch (e) {
      return reply.status(400).send({ error: (e as Error).message });
    }
  });
}
