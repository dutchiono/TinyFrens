import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AppContext } from '../context.js';

export function registerHealthRoutes(app: FastifyInstance, context: AppContext): void {
  app.get('/health', async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.status(200).send({ ok: true });
  });
}
