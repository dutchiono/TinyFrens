import fs from 'node:fs';
import path from 'node:path';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AppContext } from '../context.js';

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

function loadEconomyConfigFile(): EconomyConfig {
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

export function registerEconomyRoutes(app: FastifyInstance, context: AppContext): void {
  app.get('/api/economy/status', async (_request: FastifyRequest, reply: FastifyReply) => {
    const data = getEconomySettings(context);
    return reply.status(200).send(data);
  });
}
