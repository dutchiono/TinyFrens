import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AppContext } from '../context.js';
import { verifyGithubWebhookSignature } from '../crypto/signatures.js';
import { issueEvent, issueEventMessage } from '../integrations/github.js';
import { TG_API } from '../integrations/telegram.js';
import { githubAnnouncement, sendGithubDiscordUpdate } from '../integrations/github-announcements.js';

export function registerGithubRoutes(app: FastifyInstance, context: AppContext): void {
  app.post(
    '/api/github/webhook',
    { bodyLimit: 1024 * 1024, config: { rawBody: true } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const secret = context.config.GITHUB_WEBHOOK_SECRET;
        if (!secret) {
          return reply.status(200).send({ ok: true });
        }

        const rawBody = (request as unknown as { rawBody?: Buffer }).rawBody || Buffer.from('');
        const sigHeader = (request.headers['x-hub-signature-256'] as string) || '';

        if (!verifyGithubWebhookSignature(secret, rawBody, sigHeader)) {
          return reply.status(401).send({ error: 'invalid signature' });
        }

        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(rawBody.toString('utf-8'));
        } catch {
          return reply.status(200).send({ ok: true });
        }

        if (!payload || typeof payload !== 'object') {
          return reply.status(200).send({ ok: true });
        }

        const eventHeader = request.headers['x-github-event'] as string | undefined;
        if (eventHeader) {
          payload.event = eventHeader;
        }

        const announcement = githubAnnouncement(eventHeader || '', payload);
        if (announcement && context.config.DISCORD_UPDATES_CHANNEL_ID && context.config.DISCORD_BOT_TOKEN) {
          try {
            await sendGithubDiscordUpdate(context.config.DISCORD_UPDATES_CHANNEL_ID, context.config.DISCORD_BOT_TOKEN, announcement);
          } catch (error) {
            request.log.error({ error }, 'GitHub Discord announcement failed');
            return reply.status(502).send({ error: 'Discord announcement failed; GitHub may retry delivery' });
          }
        }

        const details = issueEvent(payload);
        if (!details) {
          return reply.status(200).send({ ok: true });
        }

        const chatId = context.repos.telegram.getChatForIssue(details.repo, details.number);
        const botToken = context.config.TELEGRAM_BOT_TOKEN;

        if (chatId) {
          const text = issueEventMessage(details);
          if (text) {
            try {
              if (chatId.startsWith('dc:') && context.config.DISCORD_BOT_TOKEN) {
                const [, , channelId] = chatId.split(':', 3);
                const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
                  method: 'POST',
                  headers: {
                    Authorization: `Bot ${context.config.DISCORD_BOT_TOKEN}`,
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({ content: text, allowed_mentions: { parse: [] } }),
                  signal: AbortSignal.timeout(8_000),
                });
                if (!response.ok) throw new Error(`Discord returned HTTP ${response.status}`);
              } else if (botToken) {
                const response = await fetch(`${TG_API}/bot${botToken}/sendMessage`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ chat_id: chatId, text }),
                  signal: AbortSignal.timeout(8_000),
                });
                if (!response.ok) throw new Error(`Telegram returned HTTP ${response.status}`);
              }
            } catch (error) {
              void context.operationalAlerts.report(
                'github:issue-relay',
                `GitHub issue update could not reach ${chatId.startsWith('dc:') ? 'Discord' : 'Telegram'}`,
                error instanceof Error ? error.message : String(error)
              );
            }
          }
        }

        return reply.status(200).send({ ok: true });
      } catch (e) {
        return reply.status(400).send({ error: (e as Error).message });
      }
    }
  );
}
