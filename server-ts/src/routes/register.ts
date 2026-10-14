import { FastifyInstance } from 'fastify';
import { AppContext } from '../context.js';
import { normalizeProfile } from '../domain/profile.js';
import { mintPet } from '../domain/account.js';
import { getClientIp } from '../rate-limit.js';

export function registerRegistrationRoutes(app: FastifyInstance, context: AppContext): void {
  app.post('/api/register', async (request, reply) => {
    try {
      const trustProxy = Boolean(context.config.TRUST_PROXY);
      const ip = getClientIp(request, trustProxy);
      context.rateLimiter.limit(`register:${ip}`, 10, 3600, context.now());

      const body = request.body as Record<string, unknown> | null;
      if (!body || typeof body !== 'object' || !('pet' in body)) {
        return reply.status(400).send({ error: "'pet'" });
      }

      const pet = normalizeProfile(body.pet);
      const minted = mintPet(context.db, pet);

      return reply.status(200).send({
        id: minted.id,
        token: minted.token,
        code: minted.code,
      });
    } catch (e) {
      return reply.status(400).send({ error: (e as Error).message });
    }
  });
}
