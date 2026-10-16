import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig } from './config.js';
import { createDbConnection } from './db/connection.js';
import { runMigrations } from './db/migrations.js';
import { createAppContext } from './context.js';
import { buildApp } from './app.js';
import { startWorkers, Workers } from './workers.js';
import { createGracefulShutdown } from './lifecycle.js';
import { syncTelegramCommands } from './integrations/telegram-commands.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const db = createDbConnection(config.DB_PATH, { readonly: config.DB_READ_ONLY });

  if (!config.DB_READ_ONLY) runMigrations(db);

  const context = createAppContext(config, db);
  const app = await buildApp({
    context,
    serverOptions: {
      logger: {
        level: config.LOG_LEVEL,
      },
    },
  });

  let workers: Workers | undefined;
  try {
    if (!config.DB_READ_ONLY) {
      workers = startWorkers(context, undefined, (worker, error) => {
        app.log.error({ err: error, worker }, 'Background worker poll failed');
        void context.operationalAlerts.report(
          `worker:${worker}`,
          `${worker} background worker failed`,
          error instanceof Error ? error.message : String(error)
        );
      });
    }
    await app.listen({ host: config.HOST, port: config.PORT });
    app.log.info(`TinyFrens TypeScript server listening on http://${config.HOST}:${config.PORT}`);
    if (config.TELEGRAM_BOT_TOKEN) {
      await syncTelegramCommands(context.telegramApi, config.TELEGRAM_BOT_TOKEN).then(
        () => app.log.info('Telegram command menus synchronized'),
        error => {
          app.log.warn({ err: error }, 'Telegram command menu synchronization failed');
          void context.operationalAlerts.report(
            'telegram:command-sync',
            'Telegram command menu synchronization failed',
            error instanceof Error ? error.message : String(error)
          );
        }
      );
    }
  } catch (err) {
    app.log.error({ err }, 'Server startup failed');
    await context.operationalAlerts.report(
      'server:startup',
      'Server startup failed',
      err instanceof Error ? err.message : String(err)
    );
    await workers?.stop().catch(stopError => app.log.error({ err: stopError }, 'Worker startup cleanup failed'));
    await app.close().catch(closeError => app.log.error({ err: closeError }, 'Startup cleanup failed'));
    process.exitCode = 1;
    return;
  }

  const shutdown = createGracefulShutdown({
    stopWorkers: () => workers?.stop() || Promise.resolve(),
    closeApp: () => app.close(),
  });

  const handleSignal = (signal: NodeJS.Signals) => {
    app.log.info({ signal }, 'Shutting down server');
    void shutdown().then(
      () => process.exit(0),
      async err => {
        app.log.error({ err }, 'Error during shutdown');
        await context.operationalAlerts.report(
          'server:shutdown',
          'Server shutdown failed',
          err instanceof Error ? err.message : String(err)
        );
        process.exit(1);
      }
    );
  };

  process.once('SIGINT', handleSignal);
  process.once('SIGTERM', handleSignal);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main();
}

export { main };
