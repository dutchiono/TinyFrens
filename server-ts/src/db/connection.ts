import Database, { Database as DatabaseInstance, Statement as BetterStatement } from 'better-sqlite3';

export interface Statement<T = unknown> {
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  get(...params: unknown[]): T | undefined;
  all(...params: unknown[]): T[];
}

export interface DatabaseConnection {
  exec(sql: string): void;
  prepare<T = unknown>(sql: string): Statement<T>;
  transaction<T>(fn: () => T): () => T;
  close(): void;
  getRawHandle(): DatabaseInstance;
}

export class BetterSqliteConnection implements DatabaseConnection {
  private db: DatabaseInstance;

  constructor(pathOrDb: string | DatabaseInstance, options: { readonly?: boolean } = {}) {
    if (typeof pathOrDb === 'string') {
      this.db = options.readonly
        ? new Database(pathOrDb, { readonly: true, fileMustExist: true })
        : new Database(pathOrDb);
      // WAL mode, busy timeout, and foreign keys matching production SQLite expectations
      if (pathOrDb !== ':memory:' && !options.readonly) {
        this.db.pragma('journal_mode = WAL');
      }
      this.db.pragma('busy_timeout = 5000');
      this.db.pragma('foreign_keys = ON');
    } else {
      this.db = pathOrDb;
    }
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  prepare<T = unknown>(sql: string): Statement<T> {
    const stmt = this.db.prepare(sql) as BetterStatement;
    return {
      run: (...params: unknown[]) => stmt.run(...params),
      get: (...params: unknown[]) => stmt.get(...params) as T | undefined,
      all: (...params: unknown[]) => stmt.all(...params) as T[],
    };
  }

  transaction<T>(fn: () => T): () => T {
    return this.db.transaction(fn);
  }

  close(): void {
    if (this.db.open) {
      this.db.close();
    }
  }

  getRawHandle(): DatabaseInstance {
    return this.db;
  }
}

export function createDbConnection(
  path: string = ':memory:',
  options: { readonly?: boolean } = {}
): DatabaseConnection {
  return new BetterSqliteConnection(path, options);
}

export const createDatabaseConnection = createDbConnection;

