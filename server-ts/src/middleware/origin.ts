import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getAllowedOrigins } from '../config.js';
import { AppContext } from '../context.js';

export const PUBLIC_PATHS = new Set([
  '/',
  '/health',
  '/health/revision',
  '/admin',
  '/admin/',
  '/admin.html',
  '/web/admin.html',
  '/api/github/webhook',
  '/api/robots/gallery',
  '/api/hood-turtles/preview',
  '/.well-known/farcaster.json',
  '/api/nft/uri',
  '/api/snap',
  '/api/snap/interact',
  '/snap',
  '/api/farcaster/notify',
  '/api/farcaster/webhook',
  '/api/farcaster/cast',
  '/api/telegram/auth',
  '/api/telegram/webhook',
  '/api/discord/token',
  '/api/discord/interactions',
]);

export const AGENT_PATHS = new Set([
  '/api/turtle-connect/challenge',
  '/api/turtle-connect/confirm',
]);

export function registerOriginGuard(app: FastifyInstance, context: AppContext): void {
  const allowed = getAllowedOrigins(context.config);

  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const origin = request.headers.origin;
    const path = request.url.split('?')[0];
    const accept = request.headers.accept || '';

    const isSnapReq = accept.includes('application/vnd.farcaster.snap+json');
    const isPublic = PUBLIC_PATHS.has(path) || isSnapReq || path.startsWith('/web/');
    const isAgent = AGENT_PATHS.has(path) && origin === undefined;
    const isAdmin = path.startsWith('/api/admin/');
    const isInternal = (path === '/api/internal/website-published' || path === '/api/internal/deployment-verified') && origin === undefined;

    if (!isPublic && !isAgent && !isAdmin && !isInternal && (!origin || !allowed.has(origin))) {
      reply.status(403);
      throw new Error('Origin not allowed');
    }

    if (request.method === 'OPTIONS') {
      applyCorsHeaders(reply, { isPublic, isAgent, isAdmin, origin, allowed });
      return reply.status(200).send();
    }
  });

  app.addHook('onSend', async (request: FastifyRequest, reply: FastifyReply, payload) => {
    if ((reply as FastifyReply & { skipOriginHeaders?: boolean }).skipOriginHeaders) return payload;

    const origin = request.headers.origin;
    const path = request.url.split('?')[0];
    const accept = request.headers.accept || '';

    const isSnapReq = accept.includes('application/vnd.farcaster.snap+json');
    const isPublic = PUBLIC_PATHS.has(path) || isSnapReq || path.startsWith('/web/');
    const isAgent = AGENT_PATHS.has(path) && origin === undefined;
    const isAdmin = path.startsWith('/api/admin/');

    applyCorsHeaders(reply, { isPublic, isAgent, isAdmin, origin, allowed });
    return payload;
  });
}

function applyCorsHeaders(
  reply: FastifyReply,
  state: {
    isPublic: boolean;
    isAgent: boolean;
    isAdmin: boolean;
    origin?: string;
    allowed: Set<string>;
  }
): void {
  const { isPublic, isAgent, isAdmin, origin, allowed } = state;

  if (isAgent) {
    reply.header('Cache-Control', 'no-store');
  }

  if (isPublic) {
    reply.header('Access-Control-Allow-Origin', '*');
    reply.header('Access-Control-Allow-Headers', 'Content-Type, Accept, X-Snap-Payload');
    reply.header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  } else if (isAdmin) {
    reply.header('Access-Control-Allow-Origin', origin || '*');
    reply.header('Vary', 'Origin');
    reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    reply.header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    reply.header('Cache-Control', 'no-store');
  } else if (origin && allowed.has(origin)) {
    reply.header('Access-Control-Allow-Origin', origin);
    reply.header('Vary', 'Origin');
    reply.header('Access-Control-Allow-Headers', 'Content-Type');
    reply.header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    reply.header('Cache-Control', 'no-store');
  }
}
