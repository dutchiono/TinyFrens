import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AppContext } from '../context.js';
import { DatabaseConnection } from '../db/connection.js';
import { Config } from '../config.js';
import {
  CARE_ACTIONS,
  FREE_ACTIONS,
} from '../domain/robot-care-rules.js';
import {
  DisabledError,
  UnauthorizedError,
  BadRequestError,
  clampInt,
  overridesOnly,
  shapeOverrides,
} from '../domain/admin.js';
import { MARKET_TOKEN } from '../domain/market-quote-math.js';
import {
  SCRAP_GROUP_BONUS_CREDITS,
  SCRAP_LOBBY_SECONDS,
  SCRAP_LOOT_TABLE,
  SCRAP_MAX_CREW_SIZE,
} from '../domain/telegram-scrap.js';
import { loadEconomyConfigFile, getEconomySettings } from './economy.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function getTreasurySettings(config: Config): {
  address: string;
  token: string | null;
  chainId: number;
  maxCreditsPerTransfer: number | null;
  enabled: boolean;
} {
  const cfg = loadEconomyConfigFile();
  const token = (
    config.FRENS_TREASURY_TOKEN ||
    config.FRENS_TOKEN ||
    cfg.production?.frensToken ||
    ''
  ).trim();
  const chainId = config.FRENS_TREASURY_CHAIN_ID || 8453;
  const cap = config.FRENS_TREASURY_MAX_CREDITS || 0;
  return {
    address: (config.FRENS_TREASURY || '').trim(),
    token: token || null,
    chainId,
    maxCreditsPerTransfer: cap || null,
    enabled: Boolean(config.FRENS_TREASURY_INDEXER),
  };
}

export function getCounts(db: DatabaseConnection, nowSec: number): Record<string, number | null> {
  const one = (sql: string, args: unknown[] = []): number | null => {
    try {
      const row = db.prepare(sql).get(...args) as Record<string, any> | undefined;
      if (!row) return 0;
      const firstVal = Object.values(row)[0];
      return firstVal !== null && firstVal !== undefined ? Number(firstVal) : 0;
    } catch {
      return null;
    }
  };
  const d = new Date(nowSec * 1000);
  const day = d.toISOString().slice(0, 10);
  return {
    registeredDevices: one('SELECT COUNT(*) FROM pets'),
    syncAccounts: one('SELECT COUNT(DISTINCT account) FROM device_sync_members'),
    creditAccounts: one('SELECT COUNT(*) FROM credit_accounts'),
    credits: one('SELECT COALESCE(SUM(balance),0) FROM credit_accounts'),
    deposits: one('SELECT COUNT(*) FROM deposits'),
    energyAccounts: one('SELECT COUNT(*) FROM player_energy'),
    purchasedEnergyMilli: one('SELECT COALESCE(SUM(purchased_milli),0) FROM player_energy'),
    energyPurchases: one("SELECT COUNT(*) FROM deposits WHERE purchase_kind='energy'"),
    walletConflicts: one(
      'SELECT COUNT(*) FROM account_wallet_conflicts WHERE resolved_at IS NULL'
    ),
    careToday: one('SELECT COALESCE(SUM(used),0) FROM robot_care_daily WHERE day=?', [day]),
  };
}

export function getScrapGameView(db: DatabaseConnection, limit: number): Record<string, unknown> {
  const summary = db.prepare<{
    total_runs: number;
    open_runs: number;
    resolved_runs: number;
    expired_runs: number;
    total_rewards: number;
  }>(`SELECT COUNT(*) AS total_runs,
             COALESCE(SUM(status='open'), 0) AS open_runs,
             COALESCE(SUM(status='resolved'), 0) AS resolved_runs,
             COALESCE(SUM(status='expired'), 0) AS expired_runs,
             COALESCE(SUM(CASE WHEN status='resolved' THEN
               reward_each * (SELECT COUNT(*) FROM tg_scrap_members m WHERE m.run_id=tg_scrap_runs.id)
             ELSE 0 END), 0) AS total_rewards
        FROM tg_scrap_runs`).get();
  const members = db.prepare<{ count: number }>('SELECT COUNT(*) AS count FROM tg_scrap_members').get()?.count || 0;
  const recent = db.prepare<{
    id: string;
    chat_id: string;
    starter_name: string;
    status: string;
    created_at: number;
    resolved_at: number | null;
    loot_name: string | null;
    rarity: string | null;
    reward_each: number | null;
    crew_size: number;
  }>(`SELECT r.id, r.chat_id, r.starter_name, r.status, r.created_at, r.resolved_at,
             r.loot_name, r.rarity, r.reward_each, COUNT(m.user_id) AS crew_size
        FROM tg_scrap_runs r LEFT JOIN tg_scrap_members m ON m.run_id=r.id
       GROUP BY r.id ORDER BY r.created_at DESC LIMIT ?`).all(limit);
  return {
    rules: {
      platforms: ['Telegram', 'Discord'],
      lobbySeconds: SCRAP_LOBBY_SECONDS,
      maxCrewSize: SCRAP_MAX_CREW_SIZE,
      groupBonusCredits: SCRAP_GROUP_BONUS_CREDITS,
      loot: SCRAP_LOOT_TABLE.map(({ rollBelow: _rollBelow, ...item }) => item),
    },
    summary: {
      totalRuns: summary?.total_runs || 0,
      openRuns: summary?.open_runs || 0,
      resolvedRuns: summary?.resolved_runs || 0,
      expiredRuns: summary?.expired_runs || 0,
      crewEntries: members,
      creditsGranted: summary?.total_rewards || 0,
    },
    recent: recent.map(row => ({
      id: row.id,
      roomId: row.chat_id,
      starterName: row.starter_name,
      status: row.status,
      createdAt: row.created_at,
      resolvedAt: row.resolved_at,
      lootName: row.loot_name,
      rarity: row.rarity,
      rewardEach: row.reward_each,
      crewSize: row.crew_size,
    })),
  };
}

export function getEconomyView(context: AppContext): Record<string, unknown> {
  const view: Record<string, unknown> = {
    treasury: null,
    creditsPerFrens: null,
    maxCreditsPerTransfer: null,
  };

  if (context.economy) {
    try {
      view.creditsPerFrens = context.economy.creditsPerFrens;
    } catch {
      // ignore
    }
  }

  try {
    const t = getTreasurySettings(context.config);
    view.treasury = t.address || null;
    view.maxCreditsPerTransfer = t.maxCreditsPerTransfer;
  } catch {
    // ignore
  }

  try {
    const s = getEconomySettings(context);
    view.enabled = Boolean(s.enabled);
    view.mode = s.mode;
    view.chainId = s.chainId;
    view.symbol = s.symbol;
    view.frensToken = s.frensToken;
    view.depositsEnabled = Boolean(s.depositsEnabled);
    view.purchaseKind = s.purchaseKind;
    view.energyMilliPerFrens = s.energyMilliPerFrens;
  } catch {
    // ignore
  }

  return view;
}

function findAdminHtmlPath(): string | null {
  const candidates = [
    path.resolve(process.cwd(), 'server/admin.html'),
    path.resolve(process.cwd(), '../server/admin.html'),
    path.resolve(__dirname, '../../../server/admin.html'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

export function registerAdminRoutes(app: FastifyInstance, context: AppContext): void {
  const guard = (request: FastifyRequest, reply: FastifyReply, allowPasswordChange = false): boolean => {
    if (!context.admin.enabled) {
      reply.status(503).send({ error: 'Admin is disabled' });
      return false;
    }
    const header = request.headers.authorization || '';
    if (!header.startsWith('Bearer ')) {
      reply.status(401).send({ error: 'Missing bearer authorization' });
      return false;
    }
    const tokenStr = header.slice(7).trim();
    const [valid, username] = context.admin.isValidToken(tokenStr);
    if (!valid) {
      reply.status(401).send({ error: 'Invalid or expired token' });
      return false;
    }
    if (!allowPasswordChange && username !== 'system' && context.admin.passwordChangeRequired(username)) {
      reply.status(403).send({ error: 'Password change required', code: 'password_change_required' });
      return false;
    }
    (request as any).adminUser = username;
    (request as any).adminToken = tokenStr;
    return true;
  };

  app.post('/api/admin/login', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!context.admin.enabled) {
      return reply.status(503).send({ error: 'Admin is disabled' });
    }
    let body: any;
    try {
      body = request.body;
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return reply.status(400).send({ error: 'Expected JSON body' });
      }
    } catch {
      return reply.status(400).send({ error: 'Expected JSON body' });
    }

    const { username, password } = body;
    if (!username || !password) {
      return reply.status(400).send({ error: 'Username and password required' });
    }

    try {
      const authResult = context.admin.authenticate(username, password);
      return reply.status(200).send(authResult);
    } catch (err: any) {
      if (err instanceof UnauthorizedError) {
        return reply.status(401).send({ error: err.message });
      }
      return reply.status(500).send({ error: 'Authentication failed' });
    }
  });

  app.post('/api/admin/logout', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!guard(request, reply, true)) return;
    const tokenStr = (request as any).adminToken;
    context.admin.logoutSession(tokenStr);
    return reply.status(200).send({ ok: true });
  });

  app.post('/api/admin/password', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!context.admin.enabled) return reply.status(503).send({ error: 'Admin is disabled' });
    const header = request.headers.authorization || '';
    const tokenStr = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    const username = context.admin.validateSession(tokenStr);
    if (!username) return reply.status(401).send({ error: 'A signed-in admin session is required' });
    const body = request.body as Record<string, unknown> | null;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return reply.status(400).send({ error: 'Expected JSON body' });
    }
    try {
      context.admin.changePassword(username, String(body.currentPassword || ''), String(body.newPassword || ''), tokenStr);
      return reply.status(200).send({ ok: true, username });
    } catch (err: any) {
      if (err instanceof UnauthorizedError) return reply.status(400).send({ error: err.message });
      if (err instanceof BadRequestError) return reply.status(400).send({ error: err.message });
      return reply.status(500).send({ error: 'Password change failed' });
    }
  });

  app.post('/api/admin/users', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!guard(request, reply)) return;
    let body: any;
    try {
      body = request.body;
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return reply.status(400).send({ error: 'Expected JSON body' });
      }
    } catch {
      return reply.status(400).send({ error: 'Expected JSON body' });
    }

    const { username, password } = body;
    try {
      const created = context.admin.createUser(username, password);
      return reply.status(200).send({
        ok: true,
        user: created,
        users: context.admin.listUsers(),
      });
    } catch (err: any) {
      if (err instanceof BadRequestError) {
        return reply.status(400).send({ error: err.message });
      }
      return reply.status(400).send({ error: err.message || 'Bad request' });
    }
  });

  app.get('/api/admin/state', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!guard(request, reply)) return;
    return reply.status(200).send({
      currentUser: (request as any).adminUser || 'admin',
      users: context.admin.listUsers(),
      settings: context.admin.effectiveSettings(),
      overrides: shapeOverrides(overridesOnly(context.db)),
      actions: [...CARE_ACTIONS],
      freeActions: [...FREE_ACTIONS],
      economy: getEconomyView(context),
      counts: getCounts(context.db, context.now()),
      audit: context.admin.recentAudit(),
    });
  });

  app.get('/api/admin/market', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!guard(request, reply)) return;
    const quote = await context.marketQuote.get({ chainId: 8453, frensToken: MARKET_TOKEN });
    return reply.status(200).header('Cache-Control', 'no-store').send(quote);
  });

  app.get('/api/admin/game', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!guard(request, reply)) return;
    const query = request.query as Record<string, string | undefined>;
    try {
      const limit = clampInt(query.limit ?? 50, 1, 200);
      return reply.status(200).send(getScrapGameView(context.db, limit));
    } catch (err: any) {
      return reply.status(400).send({ error: err.message || 'Bad request' });
    }
  });

  app.post('/api/admin/settings', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!guard(request, reply)) return;
    try {
      const effective = context.admin.save(request.body);
      return reply.status(200).send({
        settings: effective,
        overrides: shapeOverrides(overridesOnly(context.db)),
      });
    } catch (err: any) {
      if (err instanceof BadRequestError) {
        return reply.status(400).send({ error: err.message });
      }
      return reply.status(400).send({ error: err.message || 'Bad request' });
    }
  });

  app.get('/api/admin/ledger', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!guard(request, reply)) return;
    const query = request.query as Record<string, string | undefined>;
    let limit: number;
    try {
      limit = clampInt(query.limit ?? 50, 1, 200);
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }

    const rows = context.db.prepare<{
      id: number;
      pet_id: string;
      delta: number;
      balance: number;
      reason: string;
      ref_type: string;
      ref_id: string;
      created: number;
    }>(
      'SELECT id, pet_id, delta, balance, reason, ref_type, ref_id, created ' +
      'FROM credit_ledger ORDER BY id DESC LIMIT ?'
    ).all(limit);

    const entries = rows.map(r => ({
      id: r.id,
      petId: r.pet_id,
      delta: r.delta,
      balance: r.balance,
      reason: r.reason,
      refType: r.ref_type,
      refId: r.ref_id,
      created: r.created,
    }));

    const topRows = context.db.prepare<{
      pet_id: string;
      balance: number;
      updated_at: number;
    }>(
      'SELECT pet_id, balance, updated_at FROM credit_accounts ORDER BY balance DESC LIMIT ?'
    ).all(limit);

    const top = topRows.map(r => ({
      petId: r.pet_id,
      balance: r.balance,
      updatedAt: r.updated_at,
    }));

    return reply.status(200).send({ entries, top });
  });

  app.get('/api/admin/energy', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!guard(request, reply)) return;
    const query = request.query as Record<string, string | undefined>;
    let limit: number;
    try {
      limit = clampInt(query.limit ?? 50, 1, 200);
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }

    const entries = context.db.prepare<{
      id: number;
      account: string;
      rechargeable_delta_milli: number;
      purchased_delta_milli: number;
      rechargeable_balance_milli: number;
      purchased_balance_milli: number;
      reason: string;
      ref_type: string | null;
      ref_id: string | null;
      rate_version: number;
      created: number;
    }>(
      `SELECT id, account, rechargeable_delta_milli, purchased_delta_milli,
              rechargeable_balance_milli, purchased_balance_milli, reason,
              ref_type, ref_id, rate_version, created
       FROM energy_ledger ORDER BY id DESC LIMIT ?`
    ).all(limit).map(row => ({
      id: row.id,
      account: row.account,
      rechargeableDeltaMilli: row.rechargeable_delta_milli,
      purchasedDeltaMilli: row.purchased_delta_milli,
      rechargeableBalanceMilli: row.rechargeable_balance_milli,
      purchasedBalanceMilli: row.purchased_balance_milli,
      reason: row.reason,
      refType: row.ref_type,
      refId: row.ref_id,
      rateVersion: row.rate_version,
      created: row.created,
    }));

    const top = context.db.prepare<{
      account: string;
      rechargeable_milli: number;
      purchased_milli: number;
      rate_per_day_milli: number;
      capacity_milli: number;
      updated_at: number;
    }>(
      `SELECT account, rechargeable_milli, purchased_milli, rate_per_day_milli,
              capacity_milli, updated_at
       FROM player_energy
       ORDER BY rechargeable_milli + purchased_milli DESC LIMIT ?`
    ).all(limit).map(row => ({
      account: row.account,
      rechargeableMilli: row.rechargeable_milli,
      purchasedMilli: row.purchased_milli,
      totalMilli: row.rechargeable_milli + row.purchased_milli,
      ratePerDayMilli: row.rate_per_day_milli,
      capacityMilli: row.capacity_milli,
      updatedAt: row.updated_at,
    }));

    const purchases = context.db.prepare<{
      session_id: string;
      pet_id: string;
      account: string | null;
      chain_id: number;
      tx_hash: string;
      log_index: number;
      amount: string;
      energy_milli: number;
      created: number;
    }>(
      `SELECT session_id, pet_id, account, chain_id, tx_hash, log_index,
              amount, energy_milli, created
       FROM deposits WHERE purchase_kind='energy' ORDER BY id DESC LIMIT ?`
    ).all(limit).map(row => ({
      sessionId: row.session_id,
      petId: row.pet_id,
      account: row.account,
      chainId: row.chain_id,
      txHash: row.tx_hash,
      logIndex: row.log_index,
      amount: row.amount,
      energyMilli: row.energy_milli,
      created: row.created,
    }));

    return reply.status(200).send({ entries, top, purchases });
  });

  app.get('/api/admin/care', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!guard(request, reply)) return;
    const query = request.query as Record<string, string | undefined>;
    const day = query.day || new Date(context.now() * 1000).toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      return reply.status(400).send({ error: 'day must be YYYY-MM-DD' });
    }
    let limit: number;
    try {
      limit = clampInt(query.limit ?? 50, 1, 200);
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }

    const rows = context.db.prepare<{
      pet_id: string;
      used: number;
      updated: number;
    }>(
      'SELECT pet_id, used, updated FROM robot_care_daily WHERE day=? ORDER BY used DESC LIMIT ?'
    ).all(day, limit);

    return reply.status(200).send({
      day,
      allowance: context.admin.effectiveSettings().dailyAllowance,
      rows: rows.map(r => ({ petId: r.pet_id, used: r.used, updated: r.updated })),
    });
  });

  const serveAdminHtml = async (_request: FastifyRequest, reply: FastifyReply) => {
    const filePath = findAdminHtmlPath();
    if (!filePath) {
      return reply.status(404).type('text/plain').send('Admin page not found');
    }
    const html = fs.readFileSync(filePath, 'utf-8');
    return reply
      .status(200)
      .header('Content-Type', 'text/html; charset=utf-8')
      .header('Cache-Control', 'no-store, private')
      .send(html);
  };

  app.get('/admin', serveAdminHtml);
  app.get('/admin/', serveAdminHtml);
  app.get('/admin.html', serveAdminHtml);
  app.get('/web/admin.html', serveAdminHtml);
}
