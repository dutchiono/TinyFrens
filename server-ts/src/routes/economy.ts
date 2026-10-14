import fs from 'node:fs';
import path from 'node:path';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AppContext } from '../context.js';
import { tokenPet } from '../domain/account.js';
import { PACKAGES } from '../domain/economy-math.js';
import {
  EconomyError,
  NotEnabled,
  UnknownSession,
  SessionExpired,
} from '../domain/economy.js';
import { invokeAllocator, AllocatorError } from '../integrations/deposit-allocator.js';

interface EconomyBlock {
  chainId?: number;
  chainName?: string;
  explorer?: string;
  frensToken?: string | null;
  name?: string;
  symbol?: string;
  decimals?: number;
}

interface EconomyConfig {
  production?: EconomyBlock;
  testnet?: EconomyBlock;
}

export function loadEconomyConfigFile(): EconomyConfig {
  const candidates = [
    path.resolve(process.cwd(), 'contracts/config/economy.json'),
    path.resolve(process.cwd(), '../contracts/config/economy.json'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      try {
        return JSON.parse(fs.readFileSync(p, 'utf-8'));
      } catch {
        // Fall back to default
      }
    }
  }
  return {
    production: {
      chainId: 8453,
      chainName: 'base',
      explorer: 'https://basescan.org',
      frensToken: '0x1A96226727a1D0a46334b3A4b3878B32B7659ba3',
      name: 'TinyFrens',
      symbol: 'FRENS',
      decimals: 18,
    },
    testnet: {
      chainId: 84532,
      chainName: 'base-sepolia',
      explorer: 'https://sepolia.basescan.org',
      frensToken: null,
      name: 'TinyFrens Test FRENS',
      symbol: 'tfFRENS',
      decimals: 18,
    },
  };
}

export function getEconomySettings(context: AppContext): Record<string, unknown> {
  const rawMode = (context.config.ECONOMY_MODE || '').trim().toLowerCase();
  const cfg = loadEconomyConfigFile();

  if (rawMode !== 'testnet' && rawMode !== 'production') {
    return {
      enabled: false,
      mode: null,
      chainId: null,
      chainName: null,
      frensToken: null,
      symbol: 'FRENS',
      decimals: 18,
      depositsEnabled: false,
      productionToken: cfg.production?.frensToken ?? null,
    };
  }

  const block: EconomyBlock = cfg[rawMode] ?? {};
  let token = (context.config.FRENS_TOKEN || block.frensToken || '').trim();
  let chainId: number | null = context.config.CHAIN_ID ?? block.chainId ?? null;

  const addrRegex = /^0x[a-fA-F0-9]{40}$/;
  let enabled = rawMode === 'testnet' && Boolean(token && addrRegex.test(token) && chainId);

  if (rawMode === 'production') {
    const prod = cfg.production ?? {};
    if (prod.frensToken) {
      token = String(prod.frensToken).trim();
    }
    if (prod.chainId !== undefined) {
      chainId = Number(prod.chainId);
    }
    enabled = false;
  }

  const depositsEnabled = Boolean(context.config.ECONOMY_DEPOSITS && enabled);

  const result: Record<string, unknown> = {
    enabled,
    mode: rawMode,
    chainId,
    chainName: block.chainName ?? null,
    explorer: block.explorer ?? null,
    frensToken: token ? token : null,
    name: block.name ?? null,
    symbol: block.symbol ?? 'FRENS',
    decimals: block.decimals ?? 18,
    depositsEnabled,
    productionToken: cfg.production?.frensToken ?? null,
  };

  if (rawMode === 'production' && !enabled) {
    result.note =
      'Production FRENS is configured in contracts/config/economy.json; server economy stays off until testnet passes and ECONOMY_MODE=production is explicitly enabled.';
  }

  return result;
}

export function getTreasurySettings(context: AppContext): {
  address: string;
  token: string | null;
  chainId: number;
  maxCreditsPerTransfer: number | null;
  enabled: boolean;
} {
  const cfg = loadEconomyConfigFile();
  const token = (
    context.config.FRENS_TREASURY_TOKEN ||
    context.config.FRENS_TOKEN ||
    cfg.production?.frensToken ||
    ''
  ).trim();

  const chainId = context.config.FRENS_TREASURY_CHAIN_ID || 8453;
  const cap = context.config.FRENS_TREASURY_MAX_CREDITS || null;
  const treasuryAddress = (context.config.FRENS_TREASURY || '').trim();
  const enabled = Boolean(context.config.FRENS_TREASURY_INDEXER);

  return {
    address: treasuryAddress,
    token: token || null,
    chainId,
    maxCreditsPerTransfer: cap,
    enabled,
  };
}

export function registerEconomyRoutes(app: FastifyInstance, context: AppContext): void {
  // GET /api/economy/status
  app.get('/api/economy/status', async (_request: FastifyRequest, reply: FastifyReply) => {
    const data = getEconomySettings(context);
    return reply.status(200).send(data);
  });

  // POST /api/deposits/open
  app.post('/api/deposits/open', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const s = getEconomySettings(context);
      if (!s.enabled) {
        throw new NotEnabled('economy is not enabled on this server');
      }

      const body = request.body as Record<string, unknown> | null;
      if (!body || typeof body !== 'object') {
        return reply.status(400).send({ error: 'Bad request' });
      }

      const pid = tokenPet(context, body.token);
      context.rateLimiter.limit(`deposit-open:${pid}`, 10, 3600, context.now());

      const rawPkg = body.package !== undefined && body.package !== null ? Number(body.package) : PACKAGES[0];
      if (!PACKAGES.includes(rawPkg as any)) {
        return reply.status(400).send({ error: 'Unknown package' });
      }

      let alloc: { address: string; token: string | null; sessionId: string | null };
      try {
        alloc = await invokeAllocator(context.depositAllocator, pid, s.frensToken as string | null);
      } catch (allocErr: any) {
        if (allocErr instanceof NotEnabled) {
          throw allocErr;
        }
        return reply.status(503).send({ error: 'Deposit allocator unavailable' });
      }

      const session = context.economy.openSession(pid, alloc.address, rawPkg, {
        token: alloc.token,
        chainId: s.chainId as number,
        sessionId: alloc.sessionId,
      });

      return reply.status(200).send({
        depositId: session.id,
        address: session.address,
        token: s.frensToken,
        chainId: s.chainId,
        amountWei: session.expectedAmount,
        credits: session.credits,
        expiresAt: session.expiresAt,
      });
    } catch (e: any) {
      if (e instanceof NotEnabled) {
        return reply.status(503).send({ error: e.message });
      }
      return reply.status(400).send({ error: e.message || 'Bad request' });
    }
  });

  // POST /api/deposits/status
  app.post('/api/deposits/status', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = request.body as Record<string, unknown> | null;
      if (!body || typeof body !== 'object' || !body.depositId) {
        return reply.status(400).send({ error: 'Bad request' });
      }

      const pid = tokenPet(context, body.token);
      const session = context.economy.session(String(body.depositId));
      if (session.petId !== pid) {
        return reply.status(404).send({ error: 'Not found' });
      }

      return reply.status(200).send({
        depositId: session.id,
        status: session.status,
        address: session.address,
        amountWei: session.expectedAmount,
        credits: session.credits,
        expiresAt: session.expiresAt,
        txHash: session.txHash,
      });
    } catch (e: any) {
      if (e instanceof UnknownSession) {
        return reply.status(404).send({ error: e.message });
      }
      return reply.status(400).send({ error: e.message || 'Bad request' });
    }
  });

  // POST /api/deposits/confirm
  app.post('/api/deposits/confirm', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = request.body as Record<string, unknown> | null;
      if (!body || typeof body !== 'object' || !body.depositId || !body.txHash || body.amount === undefined) {
        return reply.status(400).send({ error: 'Bad request' });
      }

      const indexerSecret = context.config.ECONOMY_INDEXER_SECRET;
      if (indexerSecret && request.headers['x-indexer-secret'] !== indexerSecret) {
        return reply.status(403).send({ error: 'Forbidden' });
      }

      const s = getEconomySettings(context);
      const chainId = body.chainId !== undefined ? Number(body.chainId) : Number(s.chainId || 84532);
      const logIndex = body.logIndex !== undefined ? Number(body.logIndex) : 0;
      const address = body.address !== undefined ? String(body.address) : null;

      const result = context.economy.confirm(
        String(body.depositId),
        String(body.txHash),
        String(body.amount),
        chainId,
        logIndex,
        address
      );

      return reply.status(200).send(result);
    } catch (e: any) {
      if (e instanceof UnknownSession) {
        return reply.status(404).send({ error: e.message });
      }
      if (e instanceof SessionExpired) {
        return reply.status(409).send({ error: e.message });
      }
      return reply.status(400).send({ error: e.message || 'Bad request' });
    }
  });

  // POST /api/credits/balance
  app.post('/api/credits/balance', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = request.body as Record<string, unknown> | null;
      if (!body || typeof body !== 'object') {
        return reply.header('Cache-Control', 'no-store').status(400).send({ error: 'Bad request' });
      }

      const pid = tokenPet(context, body.token);
      const balance = context.economy.balance(pid);
      const history = context.economy.history(pid, 20);

      return reply
        .header('Cache-Control', 'no-store')
        .status(200)
        .send({
          balance,
          creditsPerFrens: context.economy.creditsPerFrens,
          history,
        });
    } catch (e: any) {
      return reply
        .header('Cache-Control', 'no-store')
        .status(400)
        .send({ error: e.message || 'Bad request' });
    }
  });
}
