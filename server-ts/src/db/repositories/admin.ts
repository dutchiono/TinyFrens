import { DatabaseConnection } from '../connection.js';

export interface AppSettingRow {
  key: string;
  value: string;
  updated: number;
}

export interface AdminUserRow {
  username: string;
  salt: string;
  password_hash: string;
  created: number;
  updated: number;
}

export interface AdminSessionRow {
  token: string;
  username: string;
  created: number;
  expires: number;
}

export interface AdminAuditRow {
  id: number;
  action: string;
  detail: string | null;
  created: number;
}

export class AdminRepository {
  constructor(private db: DatabaseConnection) {}

  // App Settings
  getAllSettings(): AppSettingRow[] {
    return this.db.prepare<AppSettingRow>('SELECT key, value, updated FROM app_settings').all();
  }

  getSetting(key: string): string | undefined {
    const row = this.db.prepare<{ value: string }>('SELECT value FROM app_settings WHERE key=?').get(key);
    return row?.value;
  }

  setSetting(key: string, value: string, nowSeconds: number): void {
    this.db.prepare(
      'INSERT OR REPLACE INTO app_settings(key, value, updated) VALUES(?, ?, ?)'
    ).run(key, value, nowSeconds);
  }

  deleteSetting(key: string): boolean {
    const result = this.db.prepare('DELETE FROM app_settings WHERE key=?').run(key);
    return result.changes > 0;
  }

  // Admin Users
  countUsers(): number {
    const row = this.db.prepare<{ count: number }>('SELECT COUNT(*) as count FROM admin_users').get();
    return row?.count ?? 0;
  }

  listUsers(): { username: string; created: number }[] {
    return this.db.prepare<{ username: string; created: number }>(
      'SELECT username, created FROM admin_users ORDER BY username ASC'
    ).all();
  }

  getUser(username: string): AdminUserRow | undefined {
    return this.db.prepare<AdminUserRow>(
      'SELECT username, salt, password_hash, created, updated FROM admin_users WHERE username=?'
    ).get(username);
  }

  createUser(username: string, salt: string, passwordHash: string, nowSeconds: number): void {
    this.db.prepare(
      'INSERT INTO admin_users(username, salt, password_hash, created, updated) VALUES(?, ?, ?, ?, ?)'
    ).run(username, salt, passwordHash, nowSeconds, nowSeconds);
  }

  updatePassword(username: string, salt: string, passwordHash: string, nowSeconds: number): boolean {
    const result = this.db.prepare(
      'UPDATE admin_users SET salt=?, password_hash=?, updated=? WHERE username=?'
    ).run(salt, passwordHash, nowSeconds, username);
    return result.changes > 0;
  }

  deleteUser(username: string): boolean {
    const result = this.db.prepare('DELETE FROM admin_users WHERE username=?').run(username);
    return result.changes > 0;
  }

  // Admin Sessions
  createSession(token: string, username: string, created: number, expires: number): void {
    this.db.prepare(
      'INSERT INTO admin_sessions(token, username, created, expires) VALUES(?, ?, ?, ?)'
    ).run(token, username, created, expires);
  }

  getSession(token: string): AdminSessionRow | undefined {
    return this.db.prepare<AdminSessionRow>(
      'SELECT token, username, created, expires FROM admin_sessions WHERE token=?'
    ).get(token);
  }

  deleteSession(token: string): boolean {
    const result = this.db.prepare('DELETE FROM admin_sessions WHERE token=?').run(token);
    return result.changes > 0;
  }

  deleteExpiredSessions(nowSeconds: number): void {
    this.db.prepare('DELETE FROM admin_sessions WHERE expires<=?').run(nowSeconds);
  }

  // Admin Audit
  recordAudit(action: string, detail: string | null, nowSeconds: number): number {
    const result = this.db.prepare(
      'INSERT INTO admin_audit(action, detail, created) VALUES(?, ?, ?)'
    ).run(action, detail, nowSeconds);
    return Number(result.lastInsertRowid);
  }

  listAuditLogs(limit: number = 50): AdminAuditRow[] {
    return this.db.prepare<AdminAuditRow>(
      'SELECT id, action, detail, created FROM admin_audit ORDER BY id DESC LIMIT ?'
    ).all(limit);
  }
}
