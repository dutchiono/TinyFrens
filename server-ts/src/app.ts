import fastify, { FastifyInstance, FastifyServerOptions } from 'fastify';
import { AppContext } from './context.js';
import { registerOriginGuard } from './middleware/origin.js';
import { registerErrorHandler } from './middleware/errors.js';
import { registerHealthRoutes } from './routes/health.js';

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

  // Routes
  registerHealthRoutes(app, context);

  // Graceful shutdown hook
  app.addHook('onClose', async () => {
    context.db.close();
  });

  return app;
}
