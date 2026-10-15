export interface RuntimeResources {
  stopWorkers(): Promise<void>;
  closeApp(): Promise<void>;
}

export class ShutdownTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Graceful shutdown exceeded ${timeoutMs}ms`);
    this.name = 'ShutdownTimeoutError';
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new ShutdownTimeoutError(timeoutMs)), timeoutMs);

    promise.then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      error => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

export function createGracefulShutdown(
  resources: RuntimeResources,
  timeoutMs = 10_000
): () => Promise<void> {
  let shutdown: Promise<void> | null = null;

  return () => {
    if (!shutdown) {
      shutdown = withTimeout(
        (async () => {
          let workerError: unknown;
          try {
            await resources.stopWorkers();
          } catch (error) {
            workerError = error;
          }

          try {
            await resources.closeApp();
          } catch (appError) {
            if (workerError) {
              throw new AggregateError([workerError, appError], 'Runtime shutdown failed');
            }
            throw appError;
          }

          if (workerError) {
            throw workerError;
          }
        })(),
        timeoutMs
      );
    }
    return shutdown;
  };
}
