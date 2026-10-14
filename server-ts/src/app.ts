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

export interface AppOptions {
  context: AppContext;
  serverOptions?: FastifyServerOptions;
}

export async function buildApp(options: AppOptions): Promise<FastifyInstance> {
  const { context, serverOptions } = options;

  const app = fastify({
    bodyLimit: 4096, // 4096 bytes request body limit matching Python client_max_size
    ...serverOptions,
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

  // Graceful shutdown hook
  app.addHook('onClose', async () => {
    context.db.close();
  });

  return app;
}
