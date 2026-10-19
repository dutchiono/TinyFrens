import crypto from 'node:crypto';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
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
  const deploymentVerified = async (request: FastifyRequest, reply: FastifyReply) => {
    const supplied = String(request.headers['x-tinyfrens-deploy-secret'] || '');
    if (!isLoopback(request.raw.socket.remoteAddress) ||
        !secretsMatch(context.config.DEPLOY_NOTIFY_SECRET, supplied)) {
      return reply.status(404).send();
    }
    const body = request.body as { revision?: unknown; target?: unknown } | null;
    const revision = String(body?.revision || '');
    const target = request.url === '/api/internal/website-published'
      ? 'website'
      : String(body?.target || '');
    try {
      if (target !== 'website' && target !== 'backend') throw new Error('Invalid deployment target');
      return reply.send(await deliverDeploymentNotification(context, revision, target));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Deployment notification failed';
      const status = message === 'Telegram bot is not configured' || message.startsWith('Deployment notification failed')
        ? 502
        : 400;
      return reply.status(status).send({ error: message });
    }
  };

  // Keep the website-specific path for the already-installed restricted publisher.
  app.post('/api/internal/website-published', deploymentVerified);
  app.post('/api/internal/deployment-verified', deploymentVerified);
}
