import { FastifyInstance } from 'fastify';
import { AppContext } from '../context.js';
import { tokenPet } from '../domain/account.js';
import {
  acceptCommunityLink,
  acceptDeviceSync,
  getCommunityLinkStatus,
  getDeviceSyncSnapshot,
  getDeviceSyncStatus,
  leaveDeviceSync,
  requestSync,
  startDeviceSync,
  updateDeviceSyncSelections,
} from '../domain/device-sync.js';
import { getClientIp } from '../rate-limit.js';

export function registerDeviceSyncRoutes(app: FastifyInstance, context: AppContext): void {
  // POST /api/device-sync/state
  app.post('/api/device-sync/state', async (request, reply) => {
    try {
      const body = request.body as Record<string, unknown> | null;
      if (!body || typeof body !== 'object') {
        throw new Error('Device credential not recognized');
      }

      const pid = tokenPet(context, body.token);
      context.rateLimiter.limit(`device-sync:state:${pid}`, 120, 60, context.now());

      if ('selection' in body || 'telegramSelection' in body) {
        const result = updateDeviceSyncSelections(
          context,
          pid,
          'selection' in body ? body.selection : undefined,
          'telegramSelection' in body ? body.telegramSelection : undefined,
          body.revision
        );
        if (result.conflict) {
          return reply
            .header('Cache-Control', 'no-store')
            .status(409)
            .send({
              error: 'Another device changed your selection. Refreshing.',
              ...result.snapshot,
            });
        }
        return reply.header('Cache-Control', 'no-store').status(200).send(result.snapshot);
      }

      const snapshot = getDeviceSyncSnapshot(context, pid);
      return reply.header('Cache-Control', 'no-store').status(200).send(snapshot);
    } catch (e) {
      return reply
        .header('Cache-Control', 'no-store')
        .status(400)
        .send({ error: (e as Error).message });
    }
  });

  // POST /api/device-sync/start
  app.post('/api/device-sync/start', async (request, reply) => {
    try {
      const body = request.body as Record<string, unknown> | null;
      if (!body || typeof body !== 'object') {
        throw new Error('Device credential not recognized');
      }

      const pid = tokenPet(context, body.token);
      context.rateLimiter.limit(`device-sync:start:${pid}`, 20, 60, context.now());

      const renew = Boolean(body.renew);
      const result = startDeviceSync(context, pid, renew);
      return reply.header('Cache-Control', 'no-store').status(200).send(result);
    } catch (e) {
      return reply
        .header('Cache-Control', 'no-store')
        .status(400)
        .send({ error: (e as Error).message });
    }
  });

  // POST /api/device-sync/request
  app.post('/api/device-sync/request', async (request, reply) => {
    try {
      const body = request.body as Record<string, unknown> | null;
      if (!body || typeof body !== 'object') {
        throw new Error('Device credential not recognized');
      }

      const pid = tokenPet(context, body.token);
      const trustProxy = Boolean(context.config.TRUST_PROXY);
      const ip = getClientIp(request, trustProxy);

      context.rateLimiter.limit(`device-sync:request:${pid}`, 20, 60, context.now());
      context.rateLimiter.limit(`device-sync-request:${ip}`, 20, 60, context.now());

      const label = body.label ? String(body.label) : 'TinyFrens device';
      const result = requestSync(context, pid, body.code, label);
      return reply.header('Cache-Control', 'no-store').status(200).send(result);
    } catch (e) {
      return reply
        .header('Cache-Control', 'no-store')
        .status(400)
        .send({ error: (e as Error).message });
    }
  });

  // POST /api/device-sync/status
  app.post('/api/device-sync/status', async (request, reply) => {
    try {
      const body = request.body as Record<string, unknown> | null;
      if (!body || typeof body !== 'object') {
        throw new Error('Device credential not recognized');
      }

      const pid = tokenPet(context, body.token);
      context.rateLimiter.limit(`device-sync:status:${pid}`, 120, 60, context.now());

      const result = getDeviceSyncStatus(context, pid, body.code);
      return reply.header('Cache-Control', 'no-store').status(200).send(result);
    } catch (e) {
      return reply
        .header('Cache-Control', 'no-store')
        .status(400)
        .send({ error: (e as Error).message });
    }
  });

  // POST /api/device-sync/accept
  app.post('/api/device-sync/accept', async (request, reply) => {
    try {
      const body = request.body as Record<string, unknown> | null;
      if (!body || typeof body !== 'object') {
        throw new Error('Device credential not recognized');
      }

      const pid = tokenPet(context, body.token);
      context.rateLimiter.limit(`device-sync:accept:${pid}`, 20, 60, context.now());

      const snapshot = acceptDeviceSync(context, pid, body.code, body.requestId);
      return reply.header('Cache-Control', 'no-store').status(200).send(snapshot);
    } catch (e) {
      return reply
        .header('Cache-Control', 'no-store')
        .status(400)
        .send({ error: (e as Error).message });
    }
  });

  app.post('/api/device-sync/community-link/status', async (request, reply) => {
    try {
      const body = request.body as Record<string, unknown> | null;
      if (!body || typeof body !== 'object') throw new Error('Device credential not recognized');
      const pid = tokenPet(context, body.token);
      context.rateLimiter.limit(`community-link:status:${pid}`, 30, 60, context.now());
      return reply.header('Cache-Control', 'no-store').status(200).send(
        getCommunityLinkStatus(context, pid, body.linkToken)
      );
    } catch (e) {
      return reply.header('Cache-Control', 'no-store').status(400).send({ error: (e as Error).message });
    }
  });

  app.post('/api/device-sync/community-link/accept', async (request, reply) => {
    try {
      const body = request.body as Record<string, unknown> | null;
      if (!body || typeof body !== 'object') throw new Error('Device credential not recognized');
      const pid = tokenPet(context, body.token);
      context.rateLimiter.limit(`community-link:accept:${pid}`, 10, 60, context.now());
      return reply.header('Cache-Control', 'no-store').status(200).send(
        acceptCommunityLink(context, pid, body.linkToken)
      );
    } catch (e) {
      return reply.header('Cache-Control', 'no-store').status(400).send({ error: (e as Error).message });
    }
  });

  // POST /api/device-sync/leave
  app.post('/api/device-sync/leave', async (request, reply) => {
    try {
      const body = request.body as Record<string, unknown> | null;
      if (!body || typeof body !== 'object') {
        throw new Error('Device credential not recognized');
      }

      const pid = tokenPet(context, body.token);
      context.rateLimiter.limit(`device-sync:leave:${pid}`, 20, 60, context.now());

      const snapshot = leaveDeviceSync(context, pid);
      return reply.header('Cache-Control', 'no-store').status(200).send(snapshot);
    } catch (e) {
      return reply
        .header('Cache-Control', 'no-store')
        .status(400)
        .send({ error: (e as Error).message });
    }
  });
}
