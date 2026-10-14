import fastify, { FastifyInstance, FastifyServerOptions } from 'fastify';
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
import { registerRegistrationRoutes } from './routes/register.js';
import { registerAccountRoutes } from './routes/account.js';
import { registerDeviceSyncRoutes } from './routes/device-sync.js';
import fastifyRawBody from 'fastify-raw-body';

export interface AppOptions {
  context: AppContext;
  serverOptions?: FastifyServerOptions;
}

export async function buildApp(options: AppOptions): Promise<FastifyInstance> {
  const { context, serverOptions } = options;

  const app = fastify({
    bodyLimit: 4096, // default 4096 bytes request body limit matching Python client_max_size
    ...serverOptions,
  });

  // Preserve raw request bodies for webhooks and signatures
  await app.register(fastifyRawBody, {
    field: 'rawBody',
    global: false,
    encoding: false,
    runFirst: true,
  });

  // Error handling
  registerErrorHandler(app);

  // Origin guard & CORS
  registerOriginGuard(app, context);

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

  // Account and device sync (Phase 6 Slice 6A)
  registerRegistrationRoutes(app, context);
  registerAccountRoutes(app, context);
  registerDeviceSyncRoutes(app, context);

  // Graceful shutdown hook
  app.addHook('onClose', async () => {
    context.db.close();
  });

  return app;
}
