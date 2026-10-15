import { DatabaseConnection } from '../db/connection.js';

const LOBBY_SECONDS = 60;
const MAX_CREW_SIZE = 4;

export interface ScrapRun {
  id: string;
  chat_id: string;
  message_id: number | null;
  starter_user_id: string;
  starter_name: string;
  status: 'open' | 'resolved';
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

function runId(now: number, random: number): string {
  const suffix = Math.floor(Math.max(0, Math.min(0.999999999, random)) * 0xfffffff)
    .toString(36)
    .padStart(5, '0');
  return `${now.toString(36)}${suffix}`;
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

export function startScrapRun(
  db: DatabaseConnection,
  chatId: string,
  userId: string,
  petId: string,
  displayName: string,
  now: number,
  random: number
): { state: ScrapState; created: boolean } {
  const existing = getOpenScrapRun(db, chatId);
  if (existing) return { state: existing, created: false };

  const id = runId(now, random);
  const name = cleanName(displayName);
  db.transaction(() => {
    db.prepare(
      `INSERT INTO tg_scrap_runs(
        id, chat_id, message_id, starter_user_id, starter_name, status, created_at, join_until
      ) VALUES(?, ?, NULL, ?, ?, 'open', ?, ?)`
    ).run(id, chatId, userId, name, now, now + LOBBY_SECONDS);
    db.prepare(
      'INSERT INTO tg_scrap_members(run_id, user_id, pet_id, display_name, reward, joined_at) VALUES(?, ?, ?, ?, 0, ?)'
    ).run(id, userId, petId, name, now);
  })();
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
  if (now > state.run.join_until || state.members.length >= MAX_CREW_SIZE) {
    return { ok: false, reason: 'full' };
  }
  db.prepare(
    'INSERT OR IGNORE INTO tg_scrap_members(run_id, user_id, pet_id, display_name, reward, joined_at) VALUES(?, ?, ?, ?, 0, ?)'
  ).run(id, userId, petId, cleanName(displayName), now);
  return { ok: true, state: getScrapState(db, id)!, changed: true };
}

function lootForRoll(roll: number): { name: string; rarity: string; reward: number } {
  if (roll < 0.6) return { name: 'Rusted Gear', rarity: 'Common', reward: 25 };
  if (roll < 0.85) return { name: 'Copper Coil', rarity: 'Uncommon', reward: 50 };
  if (roll < 0.95) return { name: 'Lithium Cell', rarity: 'Rare', reward: 100 };
  if (roll < 0.99) return { name: 'Plasma Core', rarity: 'Epic', reward: 250 };
  return { name: 'Sentient AI Chip', rarity: 'Legendary', reward: 1_000 };
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
  const groupBonus = Math.max(0, current.members.length - 1) * 10;
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
  const names = members.map(member => `• ${escapeHtml(member.display_name)}`).join('\n');
  if (run.status === 'resolved') {
    const bonus = Math.max(0, members.length - 1) * 10;
    return [
      [
        '🎮 <b>TinyFrens Group Game — Complete</b>',
        '━━━━━━━━━━━━━━━━━━━━━',
        `The crew recovered <b>${escapeHtml(run.loot_name || 'Unknown Scrap')}</b>.`,
        `Rarity: <b>${escapeHtml(run.rarity || 'Unknown')}</b>`,
        '',
        `${names}`,
        '',
        `Each operator receives <b>${run.reward_each || 0} credits</b>${bonus ? ` (${bonus} group bonus)` : ''}.`,
        '<i>One run, one result, one message.</i>',
      ].join('\n'),
      { inline_keyboard: [] },
    ];
  }

  const seconds = Math.max(0, run.join_until - now);
  const timer = seconds > 0 ? `${seconds}s left to join` : 'Lobby ready to resolve';
  return [
    [
      '🎮 <b>TinyFrens Group Game</b>',
      '━━━━━━━━━━━━━━━━━━━━━',
      `<b>${escapeHtml(run.starter_name)}</b> found a promising scrap field.`,
      `<b>${timer}</b> · Crew ${members.length}/${MAX_CREW_SIZE}`,
      '',
      names,
      '',
      '<i>Join with your robot. After the timer, any crew member can resolve the run.</i>',
    ].join('\n'),
    {
      inline_keyboard: [[
        { text: `🤝 Join (${members.length}/${MAX_CREW_SIZE})`, callback_data: `scrap:${run.id}:join` },
        { text: '✨ Reveal', callback_data: `scrap:${run.id}:resolve` },
      ]],
    },
  ];
}
