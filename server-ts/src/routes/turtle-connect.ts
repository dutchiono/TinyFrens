import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AppContext } from '../context.js';
import { getClientIp } from '../rate-limit.js';
import {
  acceptTurtlePairing,
  challengeTurtlePairing,
  confirmTurtlePairing,
  fromDeviceTurtlePairing,
  startTurtlePairing,
  statusTurtlePairing,
} from '../domain/wallet-link.js';
import { BankrVerificationUnavailableError } from '../integrations/bankr.js';

export function registerTurtleConnectRoutes(app: FastifyInstance, context: AppContext): void {
  function makeHandler(
    actionName: string,
    action: (body: Record<string, unknown>) => Promise<unknown> | unknown
  ) {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const ip = getClientIp(request, context.config.TRUST_PROXY);
        const limitCount = actionName === 'status' ? 120 : 20;
        context.rateLimiter.limit(`turtle-connect:${actionName}:${ip}`, limitCount, 60, context.now());

        const body = request.body;
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
          return reply
            .header('Cache-Control', 'no-store')
            .status(400)
            .send({ error: 'JSON object required' });
        }

        const result = await action(body as Record<string, unknown>);
        return reply.header('Cache-Control', 'no-store').status(200).send(result);
      } catch (err: any) {
        const message = err?.message ?? 'Request failed';
        const isUnavailable =
          err instanceof BankrVerificationUnavailableError ||
          message.includes('unavailable') ||
          message.includes('Robinhood Chain') ||
          message.includes('fetch failed');

        if (isUnavailable) {
          return reply
            .header('Cache-Control', 'no-store')
            .status(503)
            .send({ error: 'Turtle verification unavailable. Please try again.' });
        }

        return reply
          .header('Cache-Control', 'no-store')
          .status(400)
          .send({ error: message });
      }
    };
  }

  app.post(
    '/api/turtle-connect/start',
    makeHandler('start', body => startTurtlePairing(context, body.token, Boolean(body.renew)))
  );

  app.post(
    '/api/turtle-connect/challenge',
    makeHandler('challenge', body => challengeTurtlePairing(context, body))
  );

  app.post(
    '/api/turtle-connect/confirm',
    makeHandler('confirm', body => confirmTurtlePairing(context, body))
  );

  app.post(
    '/api/turtle-connect/status',
    makeHandler('status', body => statusTurtlePairing(context, body))
  );

  app.post(
    '/api/turtle-connect/accept',
    makeHandler('accept', body => acceptTurtlePairing(context, body))
  );

  app.post(
    '/api/turtle-connect/from-device',
    makeHandler('from_device', body => fromDeviceTurtlePairing(context, body))
  );
}
