import crypto from 'node:crypto';
import { FastifyInstance } from 'fastify';
import { AppContext } from '../context.js';
import { RealtimeHub, RealtimeSocket } from '../domain/realtime.js';

export function registerWebSocketRoutes(app: FastifyInstance, context: AppContext): RealtimeHub {
  const hub = new RealtimeHub(context);
  hub.start();
  context.realtimeHub = hub;

  app.get('/ws', {
    websocket: true,
    preValidation: async (request, reply) => {
      try {
        context.rateLimiter.limit(`connect:${request.ip || '?'}`, 60, 60, context.now());
      } catch {
        return reply.status(429).send({ error: 'Please wait before trying again' });
      }
    },
  }, (socket) => {
    const realtimeSocket = socket as unknown as RealtimeSocket;
    let petId: string | null = null;
    let authenticated = false;
    let queue = Promise.resolve();
    const authTimer = setTimeout(() => {
      if (!authenticated) socket.close(4003, 'Authentication failed');
    }, 10_000);
    authTimer.unref();

    socket.on('pong', () => {
      realtimeSocket.alive = true;
    });

    socket.on('message', raw => {
      queue = queue.then(async () => {
        try {
          if (typeof raw !== 'string' && !Buffer.isBuffer(raw) && !(raw instanceof ArrayBuffer)) {
            throw new Error(authenticated ? 'Invalid message' : 'Authentication failed');
          }
          const bytes = typeof raw === 'string' ? Buffer.byteLength(raw) : raw.byteLength;
          if (bytes > 4096) {
            socket.close(1009, 'Message too big');
            return;
          }
          const text = typeof raw === 'string' ? raw : Buffer.from(raw as ArrayBuffer).toString('utf8');
          const message = JSON.parse(text);
          if (!authenticated) {
            if (!message || typeof message !== 'object' || message.type !== 'auth' ||
              typeof message.token !== 'string' || message.token.length > 200) {
              throw new Error('Authentication failed');
            }
            const digest = crypto.createHash('sha256').update(message.token).digest('hex');
            const pet = context.repos.pets.findByToken(digest);
            if (!pet) throw new Error('Authentication failed');
            petId = pet.id;
            authenticated = true;
            clearTimeout(authTimer);
            await hub.attach(petId, realtimeSocket);
            return;
          }
          context.rateLimiter.limit(`messages:${petId}`, 120, 60, context.now());
          await hub.handle(petId!, message);
        } catch (error) {
          if (!authenticated) {
            clearTimeout(authTimer);
            socket.close(4003, 'Authentication failed');
          } else if (socket.readyState === 1) {
            socket.send(JSON.stringify({
              type: 'error',
              text: error instanceof Error ? error.message : 'Invalid message',
            }));
          }
        }
      });
    });

    socket.on('close', () => {
      clearTimeout(authTimer);
      if (petId) hub.track(queue.finally(() => hub.detach(petId!, realtimeSocket)));
    });
  });

  return hub;
}
