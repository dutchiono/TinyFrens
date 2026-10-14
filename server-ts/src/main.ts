import { loadConfig } from './config.js';
import { createDbConnection } from './db/connection.js';
import { initSchema } from './db/schema.js';
import { createAppContext } from './context.js';
import { buildApp } from './app.js';
import { startWorkers } from './workers.js';
import { createGracefulShutdown } from './lifecycle.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const db = createDbConnection(config.DB_PATH);

  initSchema(db);

  const context = createAppContext(config, db);
  const app = await buildApp({
    context,
    serverOptions: {
      logger: {
        level: process.env.LOG_LEVEL || 'info',
      },
    },
  });

  try {
    await app.listen({ host: config.HOST, port: config.PORT });
    app.log.info(`TinyFrens TypeScript server listening on http://${config.HOST}:${config.PORT}`);
  } catch (err) {
    app.log.error(err);
    await app.close().catch(closeError => app.log.error({ err: closeError }, 'Startup cleanup failed'));
    process.exitCode = 1;
    return;
  }

  let workers;
  try {
    workers = startWorkers(context);
  } catch (err) {
    app.log.error({ err }, 'Worker startup failed');
    await app.close().catch(closeError => app.log.error({ err: closeError }, 'Startup cleanup failed'));
    process.exitCode = 1;
    return;
  }

  const shutdown = createGracefulShutdown({
    stopWorkers: () => workers.stop(),
    closeApp: () => app.close(),
  });

  const handleSignal = (signal: NodeJS.Signals) => {
    app.log.info({ signal }, 'Shutting down server');
    void shutdown().then(
      () => process.exit(0),
      err => {
        app.log.error({ err }, 'Error during shutdown');
        process.exit(1);
      }
    );
  };

  process.once('SIGINT', handleSignal);
  process.once('SIGTERM', handleSignal);
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`) {
  main();
}

export { main };
