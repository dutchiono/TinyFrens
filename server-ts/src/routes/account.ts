import { FastifyInstance } from 'fastify';
import { AppContext } from '../context.js';
import { cleanName, readAccountProfile, tokenPet } from '../domain/account.js';

export function registerAccountRoutes(app: FastifyInstance, context: AppContext): void {
  app.post('/api/account/profile', async (request, reply) => {
    try {
      const body = request.body as Record<string, unknown> | null;
      if (!body || typeof body !== 'object') {
        throw new Error('Device credential not recognized');
      }

      const pid = tokenPet(context, body.token);
      context.rateLimiter.limit(`account-profile:${pid}`, 30, 60, context.now());

      if ('xHandle' in body) {
        throw new Error('X handles require verified X ownership and cannot be edited manually');
      }

      if ('displayName' in body) {
        const current = readAccountProfile(context, pid);
        const displayNameInput = body.displayName !== undefined ? body.displayName : current.displayName;
        const display = cleanName(displayNameInput);
        const account = context.repos.deviceSync.ensureAccount(pid);
        context.repos.accounts.upsertProfile(account, display, '', Math.floor(context.now()));
      }

      const result = readAccountProfile(context, pid);
      return reply.header('Cache-Control', 'no-store').status(200).send(result);
    } catch (e) {
      return reply
        .header('Cache-Control', 'no-store')
        .status(400)
        .send({ error: (e as Error).message });
    }
  });
}
