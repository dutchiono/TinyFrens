import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AppContext } from '../context.js';
import { tokenPet } from '../domain/account.js';
import { getClientIp } from '../rate-limit.js';

export function registerPushRoutes(app: FastifyInstance, context: AppContext): void {
  app.get('/api/push/public-key', async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.status(200).send({
      key: context.config.VAPID_PUBLIC_KEY || '',
    });
  });

  app.post('/api/push/subscribe', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const ip = getClientIp(request, context.config.TRUST_PROXY);
      context.rateLimiter.limit(`push-subscribe:${ip}`, 30, 3600, context.now());

      const body = request.body as any;
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw new Error('Notifications subscription was invalid');
      }

      const pid = tokenPet(context.db, body.token);
      const sub = body.subscription;
      if (!sub || typeof sub !== 'object' || Array.isArray(sub)) {
        throw new Error('Notifications subscription was invalid');
      }

      const endpoint = String(sub.endpoint || '');
      const keys = sub.keys || {};
      const p256dh = String(keys.p256dh || '');
      const auth = String(keys.auth || '');

      if (!endpoint.startsWith('https://') || endpoint.length >= 2048) {
        throw new Error('Notifications subscription was invalid');
      }
      if (
        typeof keys.p256dh !== 'string' ||
        typeof keys.auth !== 'string' ||
        p256dh.length === 0 ||
        p256dh.length >= 400 ||
        auth.length === 0 ||
        auth.length >= 400
      ) {
        throw new Error('Notifications subscription was invalid');
      }

      context.db
        .prepare(
          'INSERT OR REPLACE INTO push_subs(endpoint, p256dh, auth, pid, created) VALUES(?, ?, ?, ?, ?)'
        )
        .run(endpoint, p256dh, auth, pid, Math.floor(context.now()));

      return reply.status(200).send({ ok: true });
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  app.post('/api/push/unsubscribe', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = request.body as any;
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw new Error('Invalid request');
      }

      const pid = tokenPet(context.db, body.token);
      const endpoint = String(body.endpoint || '').slice(0, 2048);

      context.db
        .prepare('DELETE FROM push_subs WHERE endpoint=? AND pid=?')
        .run(endpoint, pid);

      return reply.status(200).send({ ok: true });
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });
}
