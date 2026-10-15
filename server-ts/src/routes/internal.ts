import crypto from 'node:crypto';
import { FastifyInstance } from 'fastify';
import { AppContext } from '../context.js';
import { deliverDeploymentNotification } from '../domain/deploy-notifications.js';

function isLoopback(address: string | undefined): boolean {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function secretsMatch(expected: string | undefined, supplied: string): boolean {
  if (!expected) return false;
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  return expectedBytes.length === suppliedBytes.length && crypto.timingSafeEqual(expectedBytes, suppliedBytes);
}

export function registerInternalRoutes(app: FastifyInstance, context: AppContext): void {
  app.post('/api/internal/website-published', async (request, reply) => {
    const supplied = String(request.headers['x-tinyfrens-deploy-secret'] || '');
    if (!isLoopback(request.raw.socket.remoteAddress) ||
        !secretsMatch(context.config.DEPLOY_NOTIFY_SECRET, supplied)) {
      return reply.status(404).send();
    }
    const body = request.body as { revision?: unknown } | null;
    const revision = String(body?.revision || '');
    try {
      return reply.send(await deliverDeploymentNotification(context, revision));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Deployment notification failed';
      const status = message === 'Telegram bot is not configured' || message.startsWith('Deployment notification failed')
        ? 502
        : 400;
      return reply.status(status).send({ error: message });
    }
  });
}
