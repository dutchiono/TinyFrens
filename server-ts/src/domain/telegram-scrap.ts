import { createHash } from 'node:crypto';
import { DatabaseConnection } from '../db/connection.js';

export const SCRAP_LOBBY_SECONDS = 5 * 60;
export const SCRAP_MAX_CREW_SIZE = 4;
export const SCRAP_GROUP_BONUS_CREDITS = 10;
export const SCRAP_LOOT_TABLE = [
  { name: 'Rusted Gear', rarity: 'Common', chancePercent: 60, reward: 25, rollBelow: 0.6 },
  { name: 'Copper Coil', rarity: 'Uncommon', chancePercent: 25, reward: 50, rollBelow: 0.85 },
  { name: 'Lithium Cell', rarity: 'Rare', chancePercent: 10, reward: 100, rollBelow: 0.95 },
  { name: 'Plasma Core', rarity: 'Epic', chancePercent: 4, reward: 250, rollBelow: 0.99 },
  { name: 'Sentient AI Chip', rarity: 'Legendary', chancePercent: 1, reward: 1_000, rollBelow: 1 },
] as const;
export const STALE_RUN_SECONDS = 10 * 60;

export interface ScrapRun {
  id: string;
  chat_id: string;
  message_id: number | null;
  starter_user_id: string;
  starter_name: string;
  status: 'open' | 'resolved' | 'expired';
  created_at: number;
  join_until: number;
  resolved_at: number | null;
  loot_name: string | null;
  rarity: string | null;
  reward_each: number | null;
}

export interface ScrapMember {
  run_id: string;
  user_id: string;
  pet_id: string;
  display_name: string;
  reward: number;
  joined_at: number;
}

export interface ScrapState {
  run: ScrapRun;
  members: ScrapMember[];
}

export type ScrapActionResult =
  | { ok: true; state: ScrapState; changed: boolean }
  | { ok: false; reason: 'missing' | 'closed' | 'full' | 'not-member' | 'waiting'; waitSeconds?: number };

function cleanName(value: string): string {
  return value.replace(/[\x00-\x1f\x7f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 24) || 'Fren';
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function runId(chatId: string, now: number, random: number): string {
  const suffix = Math.floor(Math.max(0, Math.min(0.999999999, random)) * 0xfffffff)
    .toString(36)
    .padStart(5, '0');
  const chat = createHash('sha256').update(chatId).digest('base64url').slice(0, 6);
  return `${now.toString(36)}${suffix}${chat}`;
}

function readRun(db: DatabaseConnection, id: string): ScrapRun | undefined {
  return db.prepare<ScrapRun>(
    `SELECT id, chat_id, message_id, starter_user_id, starter_name, status, created_at,
            join_until, resolved_at, loot_name, rarity, reward_each
       FROM tg_scrap_runs WHERE id=?`
  ).get(id);
}

function readMembers(db: DatabaseConnection, id: string): ScrapMember[] {
  return db.prepare<ScrapMember>(
    `SELECT run_id, user_id, pet_id, display_name, reward, joined_at
       FROM tg_scrap_members WHERE run_id=? ORDER BY joined_at, user_id`
  ).all(id);
}

export function getScrapState(db: DatabaseConnection, id: string): ScrapState | undefined {
  const run = readRun(db, id);
  return run ? { run, members: readMembers(db, id) } : undefined;
}

export function getOpenScrapRun(db: DatabaseConnection, chatId: string): ScrapState | undefined {
  const run = db.prepare<ScrapRun>(
    `SELECT id, chat_id, message_id, starter_user_id, starter_name, status, created_at,
            join_until, resolved_at, loot_name, rarity, reward_each
       FROM tg_scrap_runs WHERE chat_id=? AND status='open' LIMIT 1`
  ).get(chatId);
  return run ? { run, members: readMembers(db, run.id) } : undefined;
}

export function expireStaleScrapRun(
  db: DatabaseConnection,
  chatId: string,
  now: number
): boolean {
  const result = db.prepare(
    `UPDATE tg_scrap_runs
        SET status='expired', resolved_at=?
      WHERE chat_id=? AND status='open' AND join_until<?`
  ).run(now, chatId, now - STALE_RUN_SECONDS);
  return result.changes > 0;
}

export function startScrapRun(
  db: DatabaseConnection,
  chatId: string,
  userId: string,
  displayName: string,
  now: number,
  random: number
): { state: ScrapState; created: boolean } {
  const existing = getOpenScrapRun(db, chatId);
  if (existing) return { state: existing, created: false };

  const id = runId(chatId, now, random);
  const name = cleanName(displayName);
  db.prepare(
    `INSERT INTO tg_scrap_runs(
      id, chat_id, message_id, starter_user_id, starter_name, status, created_at, join_until
    ) VALUES(?, ?, NULL, ?, ?, 'open', ?, ?)`
  ).run(id, chatId, userId, name, now, now + SCRAP_LOBBY_SECONDS);
  return { state: getScrapState(db, id)!, created: true };
}

export function setScrapMessageId(db: DatabaseConnection, id: string, messageId: number): void {
  db.prepare('UPDATE tg_scrap_runs SET message_id=? WHERE id=?').run(messageId, id);
}

export function joinScrapRun(
  db: DatabaseConnection,
  id: string,
  userId: string,
  petId: string,
  displayName: string,
  now: number
): ScrapActionResult {
  const state = getScrapState(db, id);
  if (!state) return { ok: false, reason: 'missing' };
  if (state.run.status !== 'open') return { ok: false, reason: 'closed' };
  if (state.members.some(member => member.user_id === userId || member.pet_id === petId)) {
    return { ok: true, state, changed: false };
  }
  if (now > state.run.join_until || state.members.length >= SCRAP_MAX_CREW_SIZE) {
    return { ok: false, reason: 'full' };
  }
  db.prepare(
    'INSERT OR IGNORE INTO tg_scrap_members(run_id, user_id, pet_id, display_name, reward, joined_at) VALUES(?, ?, ?, ?, 0, ?)'
  ).run(id, userId, petId, cleanName(displayName), now);
  return { ok: true, state: getScrapState(db, id)!, changed: true };
}

function lootForRoll(roll: number): { name: string; rarity: string; reward: number } {
  const loot = SCRAP_LOOT_TABLE.find(item => roll < item.rollBelow) || SCRAP_LOOT_TABLE.at(-1)!;
  return { name: loot.name, rarity: loot.rarity, reward: loot.reward };
}

export function resolveScrapRun(
  db: DatabaseConnection,
  id: string,
  userId: string,
  now: number,
  random: number,
  grantReward: (petId: string, credits: number, runId: string) => void
): ScrapActionResult {
  const current = getScrapState(db, id);
  if (!current) return { ok: false, reason: 'missing' };
  if (current.run.status !== 'open') return { ok: true, state: current, changed: false };
  if (!current.members.some(member => member.user_id === userId)) {
    return { ok: false, reason: 'not-member' };
  }
  if (now < current.run.join_until) {
    return { ok: false, reason: 'waiting', waitSeconds: current.run.join_until - now };
  }

  const loot = lootForRoll(random);
  const groupBonus = Math.max(0, current.members.length - 1) * SCRAP_GROUP_BONUS_CREDITS;
  const rewardEach = loot.reward + groupBonus;
  db.transaction(() => {
    const changed = db.prepare(
      `UPDATE tg_scrap_runs
          SET status='resolved', resolved_at=?, loot_name=?, rarity=?, reward_each=?
        WHERE id=? AND status='open'`
    ).run(now, loot.name, loot.rarity, rewardEach, id).changes;
    if (!changed) return;
    for (const member of current.members) {
      grantReward(member.pet_id, rewardEach, id);
      db.prepare('UPDATE tg_scrap_members SET reward=? WHERE run_id=? AND pet_id=?')
        .run(rewardEach, id, member.pet_id);
    }
  })();
  return { ok: true, state: getScrapState(db, id)!, changed: true };
}

export function renderScrapCard(
  state: ScrapState,
  now: number
): [string, { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> }] {
  const { run, members } = state;
  const names = members.map(member => `• ${escapeHtml(member.display_name)}`).join('\n') || '• No one yet — press Join crew.';
  if (run.status === 'resolved') {
    const bonus = Math.max(0, members.length - 1) * SCRAP_GROUP_BONUS_CREDITS;
    return [
      [
        '🛰 <b>SCRAP RUN COMPLETE</b>',
        '━━━━━━━━━━━━━━━━━━━━━',
        `The crew recovered <b>${escapeHtml(run.loot_name || 'Unknown Scrap')}</b>`,
        `<b>${escapeHtml(run.rarity || 'Unknown')}</b> find · <b>${run.reward_each || 0} credits each</b>`,
        '',
        '<b>Crew</b>',
        `${names}`,
        bonus ? `\n🤝 Group bonus: +${bonus} each` : '',
      ].join('\n'),
      { inline_keyboard: [[{ text: '🔁 New scrap run', callback_data: 'game:new' }]] },
    ];
  }

  const seconds = Math.max(0, run.join_until - now);
  const timer = seconds > 0
    ? (seconds >= 60 ? `${Math.ceil(seconds / 60)}m left to join` : `${seconds}s left to join`)
    : 'Lobby ready to resolve';
  return [
    [
      '🛰 <b>SCRAP RUN</b>',
      '━━━━━━━━━━━━━━━━━━━━━',
      `<b>${escapeHtml(run.starter_name)}</b> found a scrap signal.`,
      `⏱ <b>${timer}</b> · Crew <b>${members.length}/${SCRAP_MAX_CREW_SIZE}</b>`,
      '',
      '<b>Crew</b>',
      names,
      '',
      '<i>Join once. When the window closes, any crew member can search. Everyone gets the same find.</i>',
    ].join('\n'),
    {
      inline_keyboard: [[
        { text: `🤝 Join crew (${members.length}/${SCRAP_MAX_CREW_SIZE})`, callback_data: `game:${run.id}:join` },
        { text: '🔎 Search scrap', callback_data: `game:${run.id}:resolve` },
      ]],
    },
  ];
}
