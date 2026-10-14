import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AppContext } from '../context.js';
import { verifyGithubWebhookSignature } from '../crypto/signatures.js';
import { issueEvent, issueEventMessage } from '../integrations/github.js';
import { TG_API } from '../integrations/telegram.js';

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

        const details = issueEvent(payload);
        if (!details) {
          return reply.status(200).send({ ok: true });
        }

        const chatId = context.repos.telegram.getChatForIssue(details.repo, details.number);
        const botToken = context.config.TELEGRAM_BOT_TOKEN;

        if (chatId && botToken) {
          const text = issueEventMessage(details);
          if (text) {
            try {
              await fetch(`${TG_API}/bot${botToken}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: chatId, text }),
              });
            } catch {
              // Best-effort relay, ignore network/API errors
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
