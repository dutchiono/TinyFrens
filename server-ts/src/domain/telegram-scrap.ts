import { createHash } from 'node:crypto';
import { DatabaseConnection } from '../db/connection.js';

const LOBBY_SECONDS = 5 * 60;
const MAX_CREW_SIZE = 4;
export const STALE_RUN_SECONDS = 10 * 60;
export type ScrapSearchMode = 'safe' | 'deep';

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
  search_mode: ScrapSearchMode | null;
  booster_used: number;
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
  | { ok: false; reason: 'missing' | 'closed' | 'full' | 'not-member' };

export interface ScrapInventoryItem {
  item: string;
  quantity: number;
}

export interface ScrapScoreRow {
  petId: string;
  displayName: string;
  salvage: number;
  runs: number;
  rareFinds: number;
  crewRuns: number;
}

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
            join_until, resolved_at, loot_name, rarity, reward_each, search_mode, booster_used
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
            join_until, resolved_at, loot_name, rarity, reward_each, search_mode, booster_used
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
  ).run(id, chatId, userId, name, now, now + LOBBY_SECONDS);
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
  now: number,
  spendEnergy?: () => void
): ScrapActionResult {
  return db.transaction(() => {
    const state = getScrapState(db, id);
    if (!state) return { ok: false as const, reason: 'missing' as const };
    if (state.run.status !== 'open') return { ok: false as const, reason: 'closed' as const };
    if (state.members.some(member => member.user_id === userId || member.pet_id === petId)) {
      return { ok: true as const, state, changed: false };
    }
    if (state.members.length >= MAX_CREW_SIZE) {
      return { ok: false as const, reason: 'full' as const };
    }
    spendEnergy?.();
    db.prepare(
      'INSERT INTO tg_scrap_members(run_id, user_id, pet_id, display_name, reward, joined_at) VALUES(?, ?, ?, ?, 0, ?)'
    ).run(id, userId, petId, cleanName(displayName), now);
    return { ok: true as const, state: getScrapState(db, id)!, changed: true };
  })();
}

function lootForRoll(mode: ScrapSearchMode, roll: number): { name: string; rarity: string; reward: number } {
  if (mode === 'deep') {
    if (roll < 0.25) return { name: 'Empty Signal', rarity: 'Miss', reward: 0 };
    if (roll < 0.6) return { name: 'Rusted Gear', rarity: 'Common', reward: 40 };
    if (roll < 0.82) return { name: 'Copper Coil', rarity: 'Uncommon', reward: 70 };
    if (roll < 0.94) return { name: 'Lithium Cell', rarity: 'Rare', reward: 150 };
    if (roll < 0.99) return { name: 'Plasma Core', rarity: 'Epic', reward: 350 };
    return { name: 'Sentient AI Chip', rarity: 'Legendary', reward: 1_000 };
  }
  if (roll < 0.65) return { name: 'Rusted Gear', rarity: 'Common', reward: 25 };
  if (roll < 0.9) return { name: 'Copper Coil', rarity: 'Uncommon', reward: 40 };
  if (roll < 0.98) return { name: 'Lithium Cell', rarity: 'Rare', reward: 75 };
  if (roll < 0.998) return { name: 'Plasma Core', rarity: 'Epic', reward: 150 };
  return { name: 'Sentient AI Chip', rarity: 'Legendary', reward: 1_000 };
}

function utcDayStart(now: number): number {
  return Math.floor(now / 86_400) * 86_400;
}

function utcWeekStart(now: number): number {
  const date = new Date(now * 1_000);
  const day = (date.getUTCDay() + 6) % 7;
  return utcDayStart(now) - day * 86_400;
}

export function getScrapInventory(db: DatabaseConnection, petId: string): ScrapInventoryItem[] {
  return db.prepare<ScrapInventoryItem>(
    'SELECT item, quantity FROM tg_scrap_inventory WHERE pet_id=? AND quantity>0 ORDER BY item'
  ).all(petId);
}

export function craftSignalBooster(db: DatabaseConnection, petId: string, now: number): boolean {
  return db.transaction(() => {
    const inventory = new Map(getScrapInventory(db, petId).map(row => [row.item, row.quantity]));
    if ((inventory.get('Rusted Gear') || 0) < 3 || (inventory.get('Copper Coil') || 0) < 2) return false;
    const update = db.prepare(
      'UPDATE tg_scrap_inventory SET quantity=quantity-?, updated_at=? WHERE pet_id=? AND item=?'
    );
    update.run(3, now, petId, 'Rusted Gear');
    update.run(2, now, petId, 'Copper Coil');
    db.prepare(
      `INSERT INTO tg_scrap_inventory(pet_id, item, quantity, updated_at) VALUES(?, 'Signal Booster', 1, ?)
       ON CONFLICT(pet_id, item) DO UPDATE SET quantity=quantity+1, updated_at=excluded.updated_at`
    ).run(petId, now);
    return true;
  })();
}

export function getWeeklyScoreboard(db: DatabaseConnection, now: number, limit = 10): ScrapScoreRow[] {
  return db.prepare<{
    pet_id: string; display_name: string; salvage: number; runs: number; rare_finds: number; crew_runs: number;
  }>(
    `SELECT m.pet_id, MAX(m.display_name) AS display_name, SUM(m.reward) AS salvage,
            COUNT(*) AS runs,
            SUM(CASE WHEN r.rarity IN ('Rare','Epic','Legendary') THEN 1 ELSE 0 END) AS rare_finds,
            SUM(CASE WHEN (SELECT COUNT(*) FROM tg_scrap_members crew WHERE crew.run_id=r.id)>1 THEN 1 ELSE 0 END) AS crew_runs
       FROM tg_scrap_members m JOIN tg_scrap_runs r ON r.id=m.run_id
      WHERE r.status='resolved' AND r.resolved_at>=?
      GROUP BY m.pet_id ORDER BY salvage DESC, rare_finds DESC, runs ASC, m.pet_id LIMIT ?`
  ).all(utcWeekStart(now), limit).map(row => ({
    petId: row.pet_id,
    displayName: row.display_name,
    salvage: Number(row.salvage),
    runs: Number(row.runs),
    rareFinds: Number(row.rare_finds),
    crewRuns: Number(row.crew_runs),
  }));
}

export function getLifetimeScrapStats(db: DatabaseConnection, petId: string): ScrapScoreRow {
  const row = db.prepare<{
    display_name: string | null; salvage: number | null; runs: number; rare_finds: number | null; crew_runs: number | null;
  }>(
    `SELECT MAX(m.display_name) AS display_name, COALESCE(SUM(m.reward), 0) AS salvage,
            COUNT(*) AS runs,
            COALESCE(SUM(CASE WHEN r.rarity IN ('Rare','Epic','Legendary') THEN 1 ELSE 0 END), 0) AS rare_finds,
            COALESCE(SUM(CASE WHEN (SELECT COUNT(*) FROM tg_scrap_members crew WHERE crew.run_id=r.id)>1 THEN 1 ELSE 0 END), 0) AS crew_runs
       FROM tg_scrap_members m JOIN tg_scrap_runs r ON r.id=m.run_id
      WHERE m.pet_id=? AND r.status='resolved'`
  ).get(petId);
  return {
    petId,
    displayName: row?.display_name || 'Fren',
    salvage: Number(row?.salvage || 0),
    runs: Number(row?.runs || 0),
    rareFinds: Number(row?.rare_finds || 0),
    crewRuns: Number(row?.crew_runs || 0),
  };
}

export function renderScrapInventory(
  db: DatabaseConnection,
  petId: string,
  energy?: { totalMilli: number; costMilli: number; waitSeconds: number | null }
): string {
  const items = getScrapInventory(db, petId);
  const lines = items.length ? items.map(row => `• ${row.item} ×${row.quantity}`) : ['• Empty'];
  const energyLine = energy
    ? `Scrap Energy: <b>${(energy.totalMilli / 1_000).toFixed(1)}</b> · Join cost: <b>${(energy.costMilli / 1_000).toFixed(0)}</b>${energy.waitSeconds === null ? ' · Recharge locked' : energy.waitSeconds > 0 ? ` · Ready in about ${Math.ceil(energy.waitSeconds / 3_600)}h` : ' · Ready now'}`
    : '';
  return ['🎒 <b>SCRAP INVENTORY</b>', ...lines, '', energyLine, 'Craft: 3 Rusted Gear + 2 Copper Coil → Signal Booster.'].filter(Boolean).join('\n');
}

export function renderScrapScoreboard(db: DatabaseConnection, now: number, petId?: string): string {
  const allRows = getWeeklyScoreboard(db, now, petId ? 1_000 : 10);
  const rows = allRows.slice(0, 10);
  const rankings = rows.length
    ? rows.map((row, index) => `${index + 1}. <b>${escapeHtml(row.displayName)}</b> — ${row.salvage} salvage · ${row.runs} runs`).join('\n')
    : 'No completed runs this week yet.';
  const own = petId ? allRows.find(row => row.petId === petId) : undefined;
  const weekly = own || { runs: 0, rareFinds: 0, crewRuns: 0 };
  const objectives = petId
    ? `\n\n<b>Your weekly objectives</b>\n${weekly.runs >= 3 ? '✅' : '⬜'} Complete 3 runs (${Math.min(weekly.runs, 3)}/3)\n${weekly.rareFinds >= 1 ? '✅' : '⬜'} Find rare scrap (${Math.min(weekly.rareFinds, 1)}/1)\n${weekly.crewRuns >= 1 ? '✅' : '⬜'} Run with a crew (${Math.min(weekly.crewRuns, 1)}/1)`
    : '';
  const lifetime = petId ? getLifetimeScrapStats(db, petId) : undefined;
  const lifetimeText = lifetime
    ? `\n\n<b>Your all-time record</b>\n${lifetime.salvage} salvage · ${lifetime.runs} runs · ${lifetime.rareFinds} rare finds · ${lifetime.crewRuns} crew runs`
    : '';
  return `🏆 <b>WEEKLY SCRAP SCOREBOARD</b>\n${rankings}${objectives}${lifetimeText}`;
}

export function resolveScrapRun(
  db: DatabaseConnection,
  id: string,
  userId: string,
  mode: ScrapSearchMode,
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
  const resolver = current.members.find(member => member.user_id === userId)!;
  let boosterUsed = false;
  if (mode === 'deep') {
    boosterUsed = db.prepare<{ quantity: number }>(
      "SELECT quantity FROM tg_scrap_inventory WHERE pet_id=? AND item='Signal Booster' AND quantity>0"
    ).get(resolver.pet_id) !== undefined;
  }
  const loot = lootForRoll(mode, boosterUsed ? 0.25 + Math.max(0, Math.min(1, random)) * 0.75 : random);
  const groupBonus = Math.max(0, current.members.length - 1) * 10;
  const rewardEach = loot.reward > 0 ? loot.reward + groupBonus : 0;
  db.transaction(() => {
    const changed = db.prepare(
      `UPDATE tg_scrap_runs
          SET status='resolved', resolved_at=?, loot_name=?, rarity=?, reward_each=?, search_mode=?, booster_used=?
        WHERE id=? AND status='open'`
    ).run(now, loot.name, loot.rarity, rewardEach, mode, boosterUsed ? 1 : 0, id).changes;
    if (!changed) return;
    if (boosterUsed) {
      db.prepare(
        "UPDATE tg_scrap_inventory SET quantity=quantity-1, updated_at=? WHERE pet_id=? AND item='Signal Booster'"
      ).run(now, resolver.pet_id);
    }
    for (const member of current.members) {
      if (rewardEach > 0) {
        grantReward(member.pet_id, rewardEach, id);
        db.prepare(
          `INSERT INTO tg_scrap_inventory(pet_id, item, quantity, updated_at) VALUES(?, ?, 1, ?)
           ON CONFLICT(pet_id, item) DO UPDATE SET quantity=quantity+1, updated_at=excluded.updated_at`
        ).run(member.pet_id, loot.name, now);
      }
      db.prepare('UPDATE tg_scrap_members SET reward=? WHERE run_id=? AND pet_id=?')
        .run(rewardEach, id, member.pet_id);
    }
  })();
  return { ok: true, state: getScrapState(db, id)!, changed: true };
}

export function renderScrapCard(
  state: ScrapState,
  _now: number
): [string, { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> }] {
  const { run, members } = state;
  const names = members.map(member => `• ${escapeHtml(member.display_name)}`).join('\n') || '• No one yet — press Join crew.';
  if (run.status === 'resolved') {
    const bonus = Math.max(0, members.length - 1) * 10;
    return [
      [
        '🛰 <b>SCRAP RUN COMPLETE</b>',
        '━━━━━━━━━━━━━━━━━━━━━',
        `The crew recovered <b>${escapeHtml(run.loot_name || 'Unknown Scrap')}</b>`,
        `<b>${escapeHtml(run.rarity || 'Unknown')}</b> find · <b>${run.reward_each || 0} credits each</b>`,
        `${run.search_mode === 'deep' ? '🌌 Deep scan' : '🛡 Safe scan'}${run.booster_used ? ' · Signal Booster used' : ''}`,
        '',
        '<b>Crew</b>',
        `${names}`,
        bonus ? `\n🤝 Group bonus: +${bonus} each` : '',
      ].join('\n'),
      { inline_keyboard: [[{ text: '🔁 New scrap run', callback_data: 'game:new' }]] },
    ];
  }

  return [
    [
      '🛰 <b>SCRAP RUN</b>',
      '━━━━━━━━━━━━━━━━━━━━━',
      `<b>${escapeHtml(run.starter_name)}</b> found a scrap signal.`,
      `⚡ <b>Live now</b> · Crew <b>${members.length}/${MAX_CREW_SIZE}</b>`,
      '',
      '<b>Crew</b>',
      names,
      '',
      '<i>Joining spends your account Energy. One Robot recharges a run in about 6 hours; owning more Robots recharges faster. Then choose a safe scan or risk a deep scan.</i>',
    ].join('\n'),
    {
      inline_keyboard: [
        [{ text: `🤝 Join crew (${members.length}/${MAX_CREW_SIZE})`, callback_data: `game:${run.id}:join` }],
        [
          { text: '🛡 Safe scan', callback_data: `game:${run.id}:safe` },
          { text: '🌌 Deep scan', callback_data: `game:${run.id}:deep` },
        ],
      ],
    },
  ];
}
