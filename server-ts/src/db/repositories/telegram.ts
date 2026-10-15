import { DatabaseConnection } from '../connection.js';

export interface TgUserRow {
  tg_id: string;
  pet_id: string;
  updated: number;
}

export interface TgFrenGameRow {
  chat_id: string;
  user_id: string;
  name: string;
  stage: string;
  level: number;
  xp: number;
  health: number;
  hunger: number;
  energy: number;
  frens_coins: number;
  inventory: string;
  updated_at: number;
}

export interface TgFilterRow {
  chat_id: string;
  trigger: string;
  response: string;
  created_by: string;
  created_at: number;
}

export interface TgChallengeRow {
  chat_id: string;
  user_id: string;
  token: string;
  answer: number;
  attempts: number;
  expires: number;
  message_id: number | null;
}

export interface TgSuspectedBotRow {
  chat_id: string;
  user_id: string;
  username: string;
  display_name: string;
  flagged_by: string;
  source_message_id: number | null;
  flagged_at: number;
}

export interface DeployNotificationChatRow {
  chat_id: string;
  username: string;
  enabled: number;
  last_revision: string;
  updated: number;
}

export class TelegramRepository {
  constructor(private db: DatabaseConnection) {}

  // TG Users Link
  getPetIdForTgUser(tgId: string): string | undefined {
    const row = this.db.prepare<{ pet_id: string }>(
      'SELECT pet_id FROM tg_users WHERE tg_id=?'
    ).get(tgId);
    return row?.pet_id;
  }

  linkTgUser(tgId: string, petId: string, updated: number): void {
    this.db.prepare(
      'INSERT OR REPLACE INTO tg_users(tg_id, pet_id, updated) VALUES(?, ?, ?)'
    ).run(tgId, petId, updated);
  }

  // Discord Users Link
  getPetIdForDcUser(userId: string): string | undefined {
    const row = this.db.prepare<{ pet_id: string }>(
      'SELECT pet_id FROM dc_users WHERE user_id=?'
    ).get(userId);
    return row?.pet_id;
  }

  linkDcUser(userId: string, petId: string, updated: number): void {
    this.db.prepare(
      'INSERT OR REPLACE INTO dc_users(user_id, pet_id, updated) VALUES(?, ?, ?)'
    ).run(userId, petId, updated);
  }

  subscribeDeployNotifications(chatId: string, username: string, updated: number): void {
    this.db.prepare(
      `INSERT INTO deploy_notification_chats(chat_id, username, enabled, last_revision, updated)
       VALUES(?, ?, 1, '', ?)
       ON CONFLICT(chat_id) DO UPDATE SET username=excluded.username, enabled=1, updated=excluded.updated`
    ).run(chatId, username.toLowerCase().replace(/^@/, ''), updated);
  }

  unsubscribeDeployNotifications(chatId: string, updated: number): void {
    this.db.prepare(
      'UPDATE deploy_notification_chats SET enabled=0, updated=? WHERE chat_id=?'
    ).run(updated, chatId);
  }

  listDeployNotificationChats(): DeployNotificationChatRow[] {
    return this.db.prepare<DeployNotificationChatRow>(
      `SELECT chat_id, username, enabled, last_revision, updated
       FROM deploy_notification_chats WHERE enabled=1 ORDER BY chat_id`
    ).all();
  }

  markDeployNotificationSent(chatId: string, revision: string, updated: number): void {
    this.db.prepare(
      'UPDATE deploy_notification_chats SET last_revision=?, updated=? WHERE chat_id=?'
    ).run(revision, updated, chatId);
  }

  // TG Media Cache
  getCachedMediaFileId(chainId: number, collection: string, tokenId: number): string | undefined {
    const row = this.db.prepare<{ file_id: string }>(
      'SELECT file_id FROM tg_media_cache WHERE chain=? AND collection=? COLLATE NOCASE AND token_id=?'
    ).get(chainId, collection, tokenId);
    return row?.file_id;
  }

  setCachedMediaFileId(
    chainId: number,
    collection: string,
    tokenId: number,
    fileId: string,
    updated: number
  ): void {
    this.db.prepare(
      'INSERT OR REPLACE INTO tg_media_cache(chain, collection, token_id, file_id, updated) VALUES(?, ?, ?, ?, ?)'
    ).run(chainId, collection, tokenId, fileId, updated);
  }

  // TG Interactive Fren Game
  getFrenGame(chatId: string, userId: string): TgFrenGameRow | undefined {
    return this.db.prepare<TgFrenGameRow>(
      `SELECT chat_id, user_id, name, stage, level, xp, health, hunger, energy, frens_coins, inventory, updated_at
       FROM tg_fren_game WHERE chat_id=? AND user_id=?`
    ).get(chatId, userId);
  }

  saveFrenGame(game: TgFrenGameRow): void {
    this.db.prepare(
      `INSERT OR REPLACE INTO tg_fren_game(
        chat_id, user_id, name, stage, level, xp, health, hunger, energy, frens_coins, inventory, updated_at
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      game.chat_id,
      game.user_id,
      game.name,
      game.stage,
      game.level,
      game.xp,
      game.health,
      game.hunger,
      game.energy,
      game.frens_coins,
      game.inventory,
      game.updated_at
    );
  }

  // TG Moderation Filters
  listFilters(chatId: string): TgFilterRow[] {
    return this.db.prepare<TgFilterRow>(
      `SELECT chat_id, trigger, response, created_by, created_at
       FROM tg_filters WHERE chat_id=? ORDER BY trigger ASC`
    ).all(chatId);
  }

  getFilter(chatId: string, trigger: string): string | undefined {
    const row = this.db.prepare<{ response: string }>(
      'SELECT response FROM tg_filters WHERE chat_id=? AND trigger=?'
    ).get(chatId, trigger);
    return row?.response;
  }

  setFilter(
    chatId: string,
    trigger: string,
    response: string,
    createdBy: string,
    createdAt: number
  ): void {
    this.db.prepare(
      'INSERT OR REPLACE INTO tg_filters(chat_id, trigger, response, created_by, created_at) VALUES(?, ?, ?, ?, ?)'
    ).run(chatId, trigger, response, createdBy, createdAt);
  }

  deleteFilter(chatId: string, trigger: string): boolean {
    const result = this.db.prepare(
      'DELETE FROM tg_filters WHERE chat_id=? AND trigger=?'
    ).run(chatId, trigger);
    return result.changes > 0;
  }

  // TG Moderation Blocklist
  listBlocklist(chatId: string): string[] {
    const rows = this.db.prepare<{ pattern: string }>(
      'SELECT pattern FROM tg_blocklist WHERE chat_id=? ORDER BY pattern ASC'
    ).all(chatId);
    return rows.map(r => r.pattern);
  }

  addBlocklistPattern(chatId: string, pattern: string, createdBy: string, createdAt: number): void {
    this.db.prepare(
      'INSERT OR REPLACE INTO tg_blocklist(chat_id, pattern, created_by, created_at) VALUES(?, ?, ?, ?)'
    ).run(chatId, pattern, createdBy, createdAt);
  }

  deleteBlocklistPattern(chatId: string, pattern: string): boolean {
    const result = this.db.prepare(
      'DELETE FROM tg_blocklist WHERE chat_id=? AND pattern=?'
    ).run(chatId, pattern);
    return result.changes > 0;
  }

  // TG Strikes
  getStrikes(chatId: string, userId: string): { strikes: number; lastViolation: string } {
    const row = this.db.prepare<{ strikes: number; last_violation: string }>(
      'SELECT strikes, last_violation FROM tg_strikes WHERE chat_id=? AND user_id=?'
    ).get(chatId, userId);
    return {
      strikes: row?.strikes ?? 0,
      lastViolation: row?.last_violation ?? '',
    };
  }

  recordStrike(
    chatId: string,
    userId: string,
    strikes: number,
    lastViolation: string,
    updatedAt: number
  ): void {
    this.db.prepare(
      'INSERT OR REPLACE INTO tg_strikes(chat_id, user_id, strikes, last_violation, updated_at) VALUES(?, ?, ?, ?, ?)'
    ).run(chatId, userId, strikes, lastViolation, updatedAt);
  }

  resetStrikes(chatId: string, userId: string): boolean {
    return this.db.prepare('DELETE FROM tg_strikes WHERE chat_id=? AND user_id=?').run(chatId, userId).changes > 0;
  }

  // TG suspected-bot review labels
  markSuspectedBot(row: TgSuspectedBotRow): void {
    this.db.prepare(
      `INSERT INTO tg_suspected_bots(
        chat_id, user_id, username, display_name, flagged_by, source_message_id, flagged_at
      ) VALUES(?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(chat_id, user_id) DO UPDATE SET
        username=excluded.username,
        display_name=excluded.display_name,
        flagged_by=excluded.flagged_by,
        source_message_id=excluded.source_message_id,
        flagged_at=excluded.flagged_at`
    ).run(
      row.chat_id,
      row.user_id,
      row.username,
      row.display_name,
      row.flagged_by,
      row.source_message_id,
      row.flagged_at
    );
  }

  getSuspectedBot(chatId: string, userId: string): TgSuspectedBotRow | undefined {
    return this.db.prepare<TgSuspectedBotRow>(
      `SELECT chat_id, user_id, username, display_name, flagged_by, source_message_id, flagged_at
       FROM tg_suspected_bots WHERE chat_id=? AND user_id=?`
    ).get(chatId, userId);
  }

  clearSuspectedBot(chatId: string, userId: string): boolean {
    return this.db.prepare(
      'DELETE FROM tg_suspected_bots WHERE chat_id=? AND user_id=?'
    ).run(chatId, userId).changes > 0;
  }

  // TG Captcha Challenges
  getChallenge(chatId: string, userId: string): TgChallengeRow | undefined {
    return this.db.prepare<TgChallengeRow>(
      'SELECT chat_id, user_id, token, answer, attempts, expires, message_id FROM tg_challenges WHERE chat_id=? AND user_id=?'
    ).get(chatId, userId);
  }

  getChallengeByToken(token: string): TgChallengeRow | undefined {
    return this.db.prepare<TgChallengeRow>(
      'SELECT chat_id, user_id, token, answer, attempts, expires, message_id FROM tg_challenges WHERE token=?'
    ).get(token);
  }

  saveChallenge(challenge: TgChallengeRow): void {
    this.db.prepare(
      `INSERT OR REPLACE INTO tg_challenges(
        chat_id, user_id, token, answer, attempts, expires, message_id
      ) VALUES(?, ?, ?, ?, ?, ?, ?)`
    ).run(
      challenge.chat_id,
      challenge.user_id,
      challenge.token,
      challenge.answer,
      challenge.attempts,
      challenge.expires,
      challenge.message_id
    );
  }

  deleteChallenge(chatId: string, userId: string): void {
    this.db.prepare('DELETE FROM tg_challenges WHERE chat_id=? AND user_id=?').run(chatId, userId);
  }

  setChallengeMessage(token: string, messageId: number | null): void {
    this.db.prepare('UPDATE tg_challenges SET message_id=? WHERE token=?').run(messageId, token);
  }

  recordChallengeFailure(token: string): number {
    const update = this.db.transaction(() => {
      const row = this.db.prepare<{ attempts: number }>(
        'SELECT attempts FROM tg_challenges WHERE token=?'
      ).get(token);
      if (!row) return 0;
      const attempts = Number(row.attempts) + 1;
      this.db.prepare('UPDATE tg_challenges SET attempts=? WHERE token=?').run(attempts, token);
      return attempts;
    });
    return update();
  }

  deleteChallengeByToken(token: string): boolean {
    return this.db.prepare('DELETE FROM tg_challenges WHERE token=?').run(token).changes > 0;
  }

  pendingChallenges(): TgChallengeRow[] {
    return this.db.prepare<TgChallengeRow>(
      'SELECT chat_id, user_id, token, answer, attempts, expires, message_id FROM tg_challenges'
    ).all();
  }

  deleteExpiredChallenges(nowSeconds: number): void {
    this.db.prepare('DELETE FROM tg_challenges WHERE expires<=?').run(nowSeconds);
  }

  // GitHub Issue Chats
  getChatForIssue(repo: string, issueNumber: number): string | undefined {
    const row = this.db.prepare<{ chat_id: string }>(
      'SELECT chat_id FROM github_issue_chats WHERE repo=? AND issue_number=?'
    ).get(repo, issueNumber);
    return row?.chat_id;
  }

  linkChatToIssue(repo: string, issueNumber: number, chatId: string): void {
    this.db.prepare(
      'INSERT OR REPLACE INTO github_issue_chats(repo, issue_number, chat_id) VALUES(?, ?, ?)'
    ).run(repo, issueNumber, chatId);
  }

  // Indexer State
  getIndexerState(key: string): string | undefined {
    const row = this.db.prepare<{ value: string }>(
      'SELECT value FROM indexer_state WHERE key=?'
    ).get(key);
    return row?.value;
  }

  setIndexerState(key: string, value: string): void {
    this.db.prepare(
      'INSERT OR REPLACE INTO indexer_state(key, value) VALUES(?, ?)'
    ).run(key, value);
  }
}
