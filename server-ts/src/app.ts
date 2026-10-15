import fastify, { FastifyInstance, FastifyServerOptions, RouteOptions } from 'fastify';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import { AppContext } from './context.js';
import { registerOriginGuard } from './middleware/origin.js';
import { registerErrorHandler } from './middleware/errors.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerBankrRoutes } from './routes/bankr.js';
import { registerEconomyRoutes } from './routes/economy.js';
import { registerNftRoutes } from './routes/nft.js';
import { registerCollectionRoutes } from './routes/collections.js';
import { registerGalleryRoutes } from './routes/galleries.js';
import { registerPushRoutes } from './routes/push.js';
import { registerFarcasterRoutes } from './routes/farcaster.js';
import { registerGithubRoutes } from './routes/github.js';
import { registerDiscordRoutes } from './routes/discord.js';
import { registerTelegramRoutes } from './routes/telegram.js';
import { registerInternalRoutes } from './routes/internal.js';
import { registerRegistrationRoutes } from './routes/register.js';
import { registerAccountRoutes } from './routes/account.js';
import { registerDeviceSyncRoutes } from './routes/device-sync.js';
import { registerTurtleConnectRoutes } from './routes/turtle-connect.js';
import { registerWalletLinkRoutes } from './routes/wallet-link.js';
import { registerRobotCareRoutes } from './routes/robot-care.js';
import { registerWalletNftRoutes } from './routes/wallet-nft.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerChatRoutes } from './routes/chat.js';
import fastifyRawBody from 'fastify-raw-body';
import fastifyWebsocket from '@fastify/websocket';
import { registerWebSocketRoutes } from './routes/websocket.js';

export interface AppOptions {
  context: AppContext;
  serverOptions?: FastifyServerOptions;
  onRoute?: (route: RouteOptions) => void;
}

export async function buildApp(options: AppOptions): Promise<FastifyInstance> {
  const { context, serverOptions } = options;

  const app = fastify({
    bodyLimit: 4096, // default 4096 bytes request body limit matching Python client_max_size
    ...serverOptions,
  });
  if (options.onRoute) app.addHook('onRoute', options.onRoute);

  // Preserve raw request bodies for webhooks and signatures
  await app.register(fastifyRawBody, {
    field: 'rawBody',
    global: false,
    encoding: false,
    runFirst: true,
  });
  await app.register(fastifyWebsocket, {
    options: { maxPayload: 4096 },
    preClose(done) {
      for (const socket of this.websocketServer.clients) socket.close(1001, 'Server stopping');
      this.websocketServer.close();
      done();
    },
  });

  // Error handling
  registerErrorHandler(app);

  // Origin guard & CORS
  registerOriginGuard(app, context);

  await app.register(fastifyStatic, {
    root: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web'),
    prefix: '/web/',
    index: false,
    decorateReply: false,
    cacheControl: false,
    setHeaders(reply, filePath) {
      if (path.extname(filePath).toLowerCase() === '.js') reply.header('Content-Type', 'text/javascript');
    },
  });
  app.options('/*', async (_request, reply) => reply.status(200).send());

  // Read-only routes (Phase 0 & Phase 4)
  registerHealthRoutes(app, context);
  registerBankrRoutes(app, context);
  registerEconomyRoutes(app, context);
  registerNftRoutes(app, context);
  registerCollectionRoutes(app, context);
  registerGalleryRoutes(app, context);
  registerPushRoutes(app, context);
  registerFarcasterRoutes(app, context);

  // Webhooks and external integrations (Phase 5)
  registerGithubRoutes(app, context);
  registerDiscordRoutes(app, context);
  registerTelegramRoutes(app, context);
  registerInternalRoutes(app, context);

  // Account and device sync (Phase 6 Slice 6A)
  registerRegistrationRoutes(app, context);
  registerAccountRoutes(app, context);
  registerDeviceSyncRoutes(app, context);

  // Wallet link & Turtle connection (Phase 6 Slice 6B)
  registerTurtleConnectRoutes(app, context);
  registerWalletLinkRoutes(app, context);

  // Robot care & companions (Phase 6 Slice 6D)
  registerRobotCareRoutes(app, context);

  // Bankr, Wallets, Minting & NFT Operations (Phase 6 Slice 6E)
  registerWalletNftRoutes(app, context);

  // Admin surface and settings (Phase 6 Slice 6F)
  registerAdminRoutes(app, context);

  // Chat (Phase 6 Slice 6G)
  registerChatRoutes(app, context);

  // Stateful realtime protocol (Phase 9)
  registerWebSocketRoutes(app, context);

  // Graceful shutdown hook
  app.addHook('onClose', async () => {
    await context.realtimeHub?.stop();
    context.db.close();
  });

  return app;
}
