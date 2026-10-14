import { loadConfig } from './config.js';
import { createDbConnection } from './db/connection.js';
import { initSchema } from './db/schema.js';
import { createAppContext } from './context.js';
import { buildApp } from './app.js';

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

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'Shutting down server');
    try {
      await app.close();
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, 'Error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  try {
    await app.listen({ host: config.HOST, port: config.PORT });
    app.log.info(`TinyFrens TypeScript server listening on http://${config.HOST}:${config.PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`) {
  main();
}

export { main };
