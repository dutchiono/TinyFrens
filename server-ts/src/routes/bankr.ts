import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AppContext } from '../context.js';

export function registerBankrRoutes(app: FastifyInstance, context: AppContext): void {
  app.get('/api/bankr/status', async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.status(200).send({
      connected: Boolean(context.config.BANKR_API_KEY),
      partner: Boolean(context.config.BANKR_PARTNER_KEY),
    });
  });
}
