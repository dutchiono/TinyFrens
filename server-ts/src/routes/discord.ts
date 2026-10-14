import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AppContext } from '../context.js';
import { verifyDiscordInteraction } from '../crypto/signatures.js';
import { exchangeDiscordCode } from '../integrations/discord.js';

export function registerDiscordRoutes(app: FastifyInstance, context: AppContext): void {
  app.post('/api/discord/token', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const clientId = context.config.DISCORD_CLIENT_ID;
      const clientSecret = context.config.DISCORD_CLIENT_SECRET;
      if (!clientId || !clientSecret) {
        return reply.status(503).send({ error: 'Discord app is not configured' });
      }

      const body = (request.body || {}) as Record<string, unknown>;
      const code = String(body.code || '');
      if (!code) {
        return reply.status(400).send({ error: 'Missing authorization code' });
      }

      const redirectUri = context.config.DISCORD_REDIRECT_URI || '';
      const [data, status] = await exchangeDiscordCode(code, clientId, clientSecret, redirectUri);

      if (status >= 400) {
        const errorMsg = (data.error_description as string) || 'Discord token exchange failed';
        return reply.status(status).send({ error: errorMsg });
      }

      return reply.status(200).send(data);
    } catch (e) {
      return reply.status(400).send({ error: (e as Error).message || 'Discord sign-in failed' });
    }
  });

  app.post(
    '/api/discord/interactions',
    { config: { rawBody: true } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const publicKey = context.config.DISCORD_PUBLIC_KEY;
        if (!publicKey) {
          return reply.status(503).send({ error: 'Discord app is not configured' });
        }

        const rawBody = (request as unknown as { rawBody?: Buffer }).rawBody || Buffer.from('');
        const signature = (request.headers['x-signature-ed25519'] as string) || '';
        const timestamp = (request.headers['x-signature-timestamp'] as string) || '';

        const verified = verifyDiscordInteraction(signature, timestamp, rawBody, publicKey);
        if (!verified) {
          reply.header('Content-Type', 'text/plain; charset=utf-8');
          return reply.status(401).send('invalid request signature');
        }

        let data: Record<string, unknown>;
        try {
          data = JSON.parse(rawBody.toString('utf-8'));
        } catch {
          return reply.status(400).send({ error: 'bad body' });
        }

        if (data.type === 1) {
          return reply.status(200).send({ type: 1 });
        }

        return reply.status(200).send({
          type: 4,
          data: { content: 'TinyFrens is launching soon in Discord! 🐾' },
        });
      } catch (e) {
        return reply.status(400).send({ error: (e as Error).message });
      }
    }
  );
}
