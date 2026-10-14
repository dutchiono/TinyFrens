import { DatabaseConnection } from '../db/connection.js';

export const TG_API = 'https://api.telegram.org';

export const SHAPES = ['cat', 'blob', 'robot', 'bunny', 'duck', 'pig', 'frog', 'turtle'];
export const PALETTE = ['#a474f1', '#66c7d2', '#ffb95e', '#82eba1', '#ff82a7', '#4d96ff'];

export interface UserProfileResult {
  name: string;
  shape: string;
  color: string;
}

export function userProfile(user: unknown): UserProfileResult {
  if (!user || typeof user !== 'object') {
    throw new Error('No Telegram user in initData');
  }
  const u = user as Record<string, unknown>;
  const rawId = u.id;
  const uid = typeof rawId === 'number' ? rawId : parseInt(String(rawId || '0'), 10) || 0;
  const rawName = u.first_name || u.username || 'Fren';
  const name = String(rawName)
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 20) || 'Fren';

  return {
    name,
    shape: SHAPES[Math.abs(uid) % SHAPES.length],
    color: PALETTE[Math.abs(uid) % PALETTE.length],
  };
}

export function replyMarkup(url: string, text = '🐾 Open TinyFrens', isPrivate = true) {
  const button = isPrivate
    ? { text, web_app: { url } }
    : { text, url };
  return { inline_keyboard: [[button]] };
}

export function linkCode(update: unknown): string | null {
  if (!update || typeof update !== 'object') return null;
  const msg = (update as Record<string, unknown>).message;
  if (!msg || typeof msg !== 'object') return null;
  const chat = (msg as Record<string, unknown>).chat;
  if (!chat || typeof chat !== 'object' || (chat as Record<string, unknown>).type !== 'private') {
    return null;
  }
  const text = String((msg as Record<string, unknown>).text || '');
  const match = text.match(/^\/link(?:@\w+)?\s+([A-HJ-NP-Z2-9 -]{12,16})\s*$/i);
  if (!match) return null;
  const code = match[1].replace(/[-\s]/g, '').toUpperCase();
  return code.length === 12 ? code : null;
}

export type UpdateKind =
  | 'callback_query'
  | 'start'
  | 'issue'
  | 'mention'
  | 'message'
  | 'added'
  | 'removed'
  | 'unknown';

export function isIssueCommand(text: unknown): boolean {
  if (typeof text !== 'string') return false;
  const cleaned = text.replace(/\s+/g, ' ').trim().toLowerCase();
  if (!cleaned || cleaned.length > 200) return false;
  if (/^\/issue(@\S+)?(\s.*)?$/.test(cleaned)) return true;
  if (
    /(?<!\w)@tinyfrensbot\b/.test(cleaned) &&
    /\b(open|file|create|make|log|raise|report|start)\s+(issue|bug\s+report|feature\s+request|ticket)\b/.test(cleaned)
  ) {
    return true;
  }
  return /\b(open|file|create|make|log|raise|report|start)\s+(?:(?:a|an|the|this|that)\s+(?:(?:github|new|bug|feature|fresh)\s+)*|(?:github|new|bug|feature|fresh)\s+)(issue|bug\s+report|feature\s+request|ticket)/.test(cleaned);
}

export function classify(update: unknown): [UpdateKind, unknown, Record<string, unknown> | null] {
  if (!update || typeof update !== 'object') {
    return ['unknown', null, null];
  }
  const u = update as Record<string, unknown>;

  if (u.callback_query && typeof u.callback_query === 'object') {
    const cq = u.callback_query as Record<string, unknown>;
    const msg = (cq.message && typeof cq.message === 'object') ? (cq.message as Record<string, unknown>) : {};
    const chat = (msg.chat && typeof msg.chat === 'object') ? (msg.chat as Record<string, unknown>) : null;
    return ['callback_query', chat?.id ?? null, chat];
  }

  if (u.message && typeof u.message === 'object') {
    const msg = u.message as Record<string, unknown>;
    const text = String(msg.text || '');
    const chat = (msg.chat && typeof msg.chat === 'object') ? (msg.chat as Record<string, unknown>) : null;
    const chatId = chat?.id ?? null;

    if (text.startsWith('/start')) {
      return ['start', chatId, chat];
    }
    if (isIssueCommand(text)) {
      return ['issue', chatId, chat];
    }

    const botUser = (process.env.TELEGRAM_BOT_USERNAME || 'tinyfrensbot').toLowerCase().replace(/^@/, '');
    const replyFrom = (msg.reply_to_message && typeof msg.reply_to_message === 'object')
      ? ((msg.reply_to_message as Record<string, unknown>).from as Record<string, unknown> | null)
      : null;
    const replyingToBot = Boolean(
      replyFrom &&
      replyFrom.is_bot === true &&
      (String(replyFrom.username || '').toLowerCase() === botUser ||
        String(replyFrom.username || '').toLowerCase() === 'tinyfrensbot' ||
        !replyFrom.username)
    );

    const botMentionRe = new RegExp(`(?<!\\w)@${botUser}\\b`, 'i');
    const isMentioned = botMentionRe.test(text) || (botUser !== 'tinyfrensbot' && /(?<!\w)@tinyfrensbot\b/i.test(text));

    if (
      isMentioned ||
      replyingToBot ||
      new RegExp(`^\\/help(?:@${botUser})?\\s*$`, 'i').test(text) ||
      /^\/help(?:@tinyfrensbot)?\s*$/i.test(text) ||
      (chat?.type === 'private' && text.trim().length > 0)
    ) {
      return ['mention', chatId, chat];
    }
    return ['message', chatId, chat];
  }

  if (u.my_chat_member && typeof u.my_chat_member === 'object') {
    const mcm = u.my_chat_member as Record<string, unknown>;
    const newMember = (mcm.new_chat_member && typeof mcm.new_chat_member === 'object')
      ? (mcm.new_chat_member as Record<string, unknown>)
      : {};
    const status = newMember.status;
    const chat = (mcm.chat && typeof mcm.chat === 'object') ? (mcm.chat as Record<string, unknown>) : null;
    if (status === 'member' || status === 'administrator') {
      return ['added', chat?.id ?? null, chat];
    }
    return ['removed', chat?.id ?? null, chat];
  }

  return ['unknown', null, null];
}

export function makeBar(value: number, maxVal = 100, length = 8): string {
  const ratio = Math.max(0.0, Math.min(1.0, value / Number(maxVal)));
  const filled = Math.round(ratio * length);
  return '█'.repeat(filled) + '░'.repeat(length - filled);
}

export function getStageName(level: number): string {
  if (level < 3) return 'Hatchling 🥚';
  if (level < 5) return 'Baby 🐣';
  if (level < 8) return 'Juvenile 🐥';
  if (level < 12) return 'Grown 🐾';
  return 'Ascended ✨';
}

export interface GamePetState {
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
  inventory: Record<string, number>;
}

export function getOrCreatePet(
  db: DatabaseConnection,
  chatId: string | number,
  userId: string | number,
  userName: string
): GamePetState {
  const cid = String(chatId);
  const uid = String(userId);
  const row = db.prepare<{
    name: string;
    stage: string;
    level: number;
    xp: number;
    health: number;
    hunger: number;
    energy: number;
    frens_coins: number;
    inventory: string;
  }>(
    'SELECT name, stage, level, xp, health, hunger, energy, frens_coins, inventory FROM tg_fren_game WHERE chat_id=? AND user_id=?'
  ).get(cid, uid);

  if (row) {
    let inv: Record<string, number> = { berries: 2, snacks: 1 };
    try {
      inv = JSON.parse(row.inventory);
    } catch {
      // fallback
    }
    return {
      chat_id: cid,
      user_id: uid,
      name: row.name,
      stage: row.stage,
      level: Number(row.level),
      xp: Number(row.xp),
      health: Number(row.health),
      hunger: Number(row.hunger),
      energy: Number(row.energy),
      frens_coins: Number(row.frens_coins),
      inventory: inv,
    };
  }

  const cleanName = (userName || 'Fren').trim().slice(0, 20);
  const petName = `${cleanName}'s Fren`;
  const now = Math.floor(Date.now() / 1000);

  db.prepare(
    'INSERT OR REPLACE INTO tg_fren_game(chat_id, user_id, name, stage, level, xp, health, hunger, energy, frens_coins, inventory, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)'
  ).run(
    cid,
    uid,
    petName,
    'Hatchling 🥚',
    1,
    0,
    100,
    70,
    100,
    50,
    JSON.stringify({ berries: 2, snacks: 1 }),
    now
  );

  return {
    chat_id: cid,
    user_id: uid,
    name: petName,
    stage: 'Hatchling 🥚',
    level: 1,
    xp: 0,
    health: 100,
    hunger: 70,
    energy: 100,
    frens_coins: 50,
    inventory: { berries: 2, snacks: 1 },
  };
}

export function performCareAction(
  db: DatabaseConnection,
  chatId: string | number,
  userId: string | number,
  action: string,
  roll?: number
): [GamePetState, string] {
  const cid = String(chatId);
  const uid = String(userId);
  const pet = getOrCreatePet(db, cid, uid, 'Fren');

  let health = pet.health;
  let hunger = pet.hunger;
  let energy = pet.energy;
  let xp = pet.xp;
  let level = pet.level;
  let coins = pet.frens_coins;
  const inventory = { ...pet.inventory };
  let note = '';

  if (action === 'feed') {
    hunger = Math.min(100, hunger + 25);
    health = Math.min(100, health + 5);
    xp += 10;
    note = '🍖 Yum! Fed delicious snacks. (+25 Hunger, +5 Health, +10 XP)';
  } else if (action === 'play') {
    if (energy < 15) {
      return [pet, '⚠️ Your Fren is too tired to play! Try resting first.'];
    }
    energy = Math.max(0, energy - 15);
    hunger = Math.max(0, hunger - 10);
    xp += 20;
    coins += 15;
    note = '🎾 Played fetch in the yard! (-15 Energy, -10 Hunger, +20 XP, +15 FRENS)';
  } else if (action === 'rest') {
    energy = 100;
    health = Math.min(100, health + 15);
    note = '💤 Cozy nap! Energy restored to 100% and Health gained +15.';
  } else if (action === 'dice') {
    if (energy < 10) {
      return [pet, '⚠️ Need at least 10 Energy for a dice adventure! Let your Fren rest first.'];
    }
    energy = Math.max(0, energy - 10);
    const diceVal =
      roll && roll >= 1 && roll <= 6
        ? roll
        : (Math.floor(Date.now()) % 6) + 1;
    if (diceVal === 1) {
      health = Math.max(10, health - 5);
      xp += 5;
      note = `🎲 Rolled a ${diceVal}! Tripped on a loose pebble. (-5 Health, +5 XP)`;
    } else if (diceVal === 2 || diceVal === 3) {
      coins += 35;
      xp += 15;
      note = `🎲 Rolled a ${diceVal}! Found shiny coins in the plaza grass! (+35 FRENS, +15 XP)`;
    } else if (diceVal === 4 || diceVal === 5) {
      coins += 70;
      xp += 25;
      inventory.berries = (inventory.berries || 0) + 1;
      note = `🎲 Rolled a ${diceVal}! Won a mini sprint challenge! (+70 FRENS, +1 Berry, +25 XP)`;
    } else {
      coins += 150;
      xp += 50;
      inventory.snacks = (inventory.snacks || 0) + 1;
      note = `🎲 Rolled a ${diceVal}! 🌟 JACKPOT! Unearthed a hidden treasure chest! (+150 FRENS, +1 Rare Snack, +50 XP)`;
    }
  } else if (action === 'bag') {
    const berries = inventory.berries || 0;
    const snacks = inventory.snacks || 0;
    return [
      pet,
      `🎒 <b>Backpack Contents</b>:\n• ${berries}x Golden Berries\n• ${snacks}x Crispy Snacks\n• ${coins} FRENS coins`,
    ];
  } else {
    note = '🐾 Ready for the next action!';
  }

  let neededXp = level * 100;
  let leveledUp = false;
  while (xp >= neededXp) {
    xp -= neededXp;
    level += 1;
    neededXp = level * 100;
    leveledUp = true;
  }

  const stage = getStageName(level);
  if (leveledUp) {
    note += `\n🎉 <b>LEVEL UP!</b> Reached Level ${level}! Stage: ${stage}!`;
  }

  const now = Math.floor(Date.now() / 1000);
  db.prepare(
    'UPDATE tg_fren_game SET stage=?, level=?, xp=?, health=?, hunger=?, energy=?, frens_coins=?, inventory=?, updated_at=? WHERE chat_id=? AND user_id=?'
  ).run(stage, level, xp, health, hunger, energy, coins, JSON.stringify(inventory), now, cid, uid);

  const updatedPet: GamePetState = {
    chat_id: cid,
    user_id: uid,
    name: pet.name,
    stage,
    level,
    xp,
    health,
    hunger,
    energy,
    frens_coins: coins,
    inventory,
  };
  return [updatedPet, note];
}

export function renderGameCard(
  pet: GamePetState,
  note?: string | null
): [string, { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> }] {
  const uid = pet.user_id;
  const name = pet.name;
  const stage = pet.stage;
  const level = pet.level;
  const xp = pet.xp;
  const neededXp = level * 100;
  const health = pet.health;
  const hunger = pet.hunger;
  const energy = pet.energy;
  const coins = pet.frens_coins;

  let text =
    `🐾 <b>${name}</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━━\n` +
    `⭐ <b>Level ${level}</b> (${stage})\n` +
    `❤️ <b>Health:</b> <code>${makeBar(health)}</code> ${health}%\n` +
    `🍖 <b>Hunger:</b> <code>${makeBar(hunger)}</code> ${hunger}%\n` +
    `⚡ <b>Energy:</b> <code>${makeBar(energy)}</code> ${energy}%\n` +
    `✨ <b>XP:</b> ${xp}/${neededXp}  ·  🪙 <b>FRENS:</b> ${coins.toLocaleString()}\n`;

  if (note) {
    text += `\n<i>${note}</i>\n`;
  }

  const keyboard = {
    inline_keyboard: [
      [
        { text: '🍖 Feed', callback_data: `g:${uid}:feed` },
        { text: '🎾 Play', callback_data: `g:${uid}:play` },
      ],
      [
        { text: '💤 Rest', callback_data: `g:${uid}:rest` },
        { text: '🎲 Dice Adventure', callback_data: `g:${uid}:dice` },
      ],
      [
        { text: '🎒 Bag', callback_data: `g:${uid}:bag` },
        { text: '🔄 Refresh', callback_data: `g:${uid}:refresh` },
      ],
    ],
  };

  return [text, keyboard];
}

export function renderGithubProgress(
  data: Record<string, unknown>,
  repoName = 'TinyFrens'
): [string, { inline_keyboard: Array<Array<{ text: string; callback_data?: string; url?: string }>> }] {
  const lines = [`⚡ <b>${repoName} Development Progress</b>`, '━━━━━━━━━━━━━━━━━━━━━━━━━━'];

  const prs = Array.isArray(data.prs) ? data.prs : [];
  if (prs.length > 0) {
    lines.push('🔀 <b>Pull Requests:</b>');
    for (const p of prs) {
      const statusEmoji = p.merged ? '✅ Merged' : p.state === 'open' ? '🟢 Open' : '⚪ Closed';
      lines.push(`• <b>#${p.num}</b> ${p.title} (<i>${statusEmoji}</i>)`);
    }
    lines.push('');
  }

  const commits = Array.isArray(data.commits) ? data.commits : [];
  if (commits.length > 0) {
    lines.push('🔨 <b>Recent Shipped Commits:</b>');
    for (const c of commits) {
      lines.push(`• <code>${c.sha}</code> ${c.msg}`);
    }
    lines.push('');
  }

  const runs = Array.isArray(data.runs) ? data.runs : [];
  if (runs.length > 0) {
    lines.push('⚙️ <b>Continuous Integration:</b>');
    for (const r of runs) {
      const badge =
        r.conclusion === 'success'
          ? '🟢 Pass'
          : r.conclusion === 'queued' || r.conclusion === 'in_progress'
          ? '🟡 Running'
          : '🔴 Failed';
      lines.push(`• ${r.name}: ${badge}`);
    }
  }

  lines.push('\n<i>All tests & PR auto-merge active.</i>');

  const keyboard = {
    inline_keyboard: [
      [
        { text: '🔄 Refresh Progress', callback_data: 'gh:refresh' },
        { text: '🐾 Open TinyFrens', url: 'https://tinyfrens.lol/' },
      ],
    ],
  };

  return [lines.join('\n'), keyboard];
}

export function publicServerStatus(
  roomCount = 0,
  uptimeSeconds = 0
): [string, { inline_keyboard: Array<Array<{ text: string; callback_data?: string; url?: string }>> }] {
  const hours = Math.floor(uptimeSeconds / 3600);
  const minutes = Math.floor((uptimeSeconds % 3600) / 60);

  const text =
    '🟢 <b>TinyFrens Server Status: Online</b>\n' +
    '━━━━━━━━━━━━━━━━━━━━━\n' +
    `⏱️ <b>Uptime:</b> ${hours}h ${minutes}m\n` +
    `🌳 <b>Active Plaza Rooms:</b> ${roomCount} spaces\n` +
    '📱 <b>Mini App & Web:</b> https://tinyfrens.lol\n' +
    '✨ Systems operational and syncing.';

  const keyboard = {
    inline_keyboard: [
      [
        { text: '🔄 Refresh Status', callback_data: 'status:refresh' },
        { text: '🐾 Step into Plaza', url: 'https://tinyfrens.lol/#party' },
      ],
    ],
  };

  return [text, keyboard];
}
