import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AppContext } from '../context.js';

export function registerHealthRoutes(app: FastifyInstance, context: AppContext): void {
  app.get('/health', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      context.db.prepare<{ ok: number }>('SELECT 1 AS ok').get();
      return reply.status(200).send({ ok: true });
    } catch {
      return reply.status(503).send({ ok: false });
    }
  });

  app.get('/health/revision', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      context.db.prepare<{ ok: number }>('SELECT 1 AS ok').get();
      return reply.status(200).send({
        ok: true,
        revision: context.config.APP_REVISION || 'development',
      });
    } catch {
      return reply.status(503).send({ ok: false });
    }
  });
}
