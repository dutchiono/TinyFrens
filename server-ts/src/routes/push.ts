import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AppContext } from '../context.js';

export function registerPushRoutes(app: FastifyInstance, context: AppContext): void {
  app.get('/api/push/public-key', async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.status(200).send({
      key: context.config.VAPID_PUBLIC_KEY || '',
    });
  });
}
