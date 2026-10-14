import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AppContext } from '../context.js';
import { getClientIp } from '../rate-limit.js';
import { tokenPet } from '../domain/account.js';
import {
  challengeWalletLink,
  confirmWalletLink,
  disconnectWalletLink,
  linkedWallets,
  statusWalletLink,
} from '../domain/wallet-link.js';
import {
  discoverWallets,
  HOOD_TURTLE_COLLECTION,
  HOOD_TURTLE_CHAIN_ID,
  turtleId,
} from '../domain/turtle-ownership.js';
import {
  EXTRA_COLLECTIONS,
  ROBOTS_CHAIN_ID,
  ROBOTS_CONTRACT,
} from '../domain/companion-verifier.js';
import { validateRobotTokenId } from '../domain/robot-care-rules.js';

export function registerWalletLinkRoutes(app: FastifyInstance, context: AppContext): void {
  // POST /api/wallet-link/status
  app.post('/api/wallet-link/status', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = request.body as Record<string, unknown> | null;
      if (!body || typeof body !== 'object') {
        return reply.status(400).send({ error: 'Device credential not recognized' });
      }
      const result = statusWalletLink(context, body.token);
      return reply.status(200).send(result);
    } catch (err: any) {
      return reply.status(400).send({ error: err?.message ?? 'Request failed' });
    }
  });

  // POST /api/wallet-link/challenge
  app.post('/api/wallet-link/challenge', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const ip = getClientIp(request, context.config.TRUST_PROXY);
      context.rateLimiter.limit(`wallet-link-challenge:${ip}`, 12, 3600, context.now());

      const body = request.body as Record<string, unknown> | null;
      if (!body || typeof body !== 'object') {
        return reply.status(400).send({ error: 'Device credential not recognized' });
      }

      const result = challengeWalletLink(context, body.token, body.address);
      return reply.status(200).send(result);
    } catch (err: any) {
      return reply.status(400).send({ error: err?.message ?? 'Request failed' });
    }
  });

  // POST /api/wallet-link/confirm
  app.post('/api/wallet-link/confirm', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const ip = getClientIp(request, context.config.TRUST_PROXY);
      context.rateLimiter.limit(`wallet-link-confirm:${ip}`, 20, 3600, context.now());

      const body = request.body as Record<string, unknown> | null;
      if (!body || typeof body !== 'object') {
        return reply.status(400).send({ error: 'Device credential not recognized' });
      }

      const result = await confirmWalletLink(context, body.token, body.signature);
      return reply.status(200).send(result);
    } catch (err: any) {
      return reply.status(400).send({ error: err?.message ?? 'Request failed' });
    }
  });

  // POST /api/wallet-link/disconnect
  app.post('/api/wallet-link/disconnect', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = request.body as Record<string, unknown> | null;
      if (!body || typeof body !== 'object') {
        return reply.status(400).send({ error: 'Device credential not recognized' });
      }

      const result = disconnectWalletLink(context, body.token, body.address);
      return reply.status(200).send(result);
    } catch (err: any) {
      return reply.status(400).send({ error: err?.message ?? 'Request failed' });
    }
  });

  // POST /api/wallet-link/nfts
  app.post('/api/wallet-link/nfts', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = request.body as Record<string, unknown> | null;
      if (!body || typeof body !== 'object') {
        return reply.status(400).send({ error: 'Device credential not recognized' });
      }

      const pid = tokenPet(context, body.token);
      context.rateLimiter.limit(`wallet-link-nfts:${pid}`, 20, 3600, context.now());

      const addresses = linkedWallets(context, pid);
      if (!addresses.length) {
        return reply.status(400).send({ error: 'Link a wallet first' });
      }

      // Gather discovery from Turtle, Robots, and Extra collections
      const extraKeys = Object.keys(EXTRA_COLLECTIONS);
      const labels = [
        'Hood Turtles',
        ...addresses.map(() => 'Robots v1'),
        ...extraKeys.map(c => EXTRA_COLLECTIONS[c][2]),
      ];

      const tasks: Promise<{ nfts: any[]; partial?: boolean }>[] = [
        discoverWallets(
          addresses,
          context.turtleOwnership,
          context.config.ROBINHOOD_RPC_URL,
          context.config.ROBINHOOD_BLOCKSCOUT_API_URL
        ),
        ...addresses.map(addr => context.robotsVerifier.discover(addr)),
        ...extraKeys.map(col => context.extraCompanionsVerifier.discover(addresses, col)),
      ];

      const results = await Promise.allSettled(tasks);
      const successes: { nfts: any[]; partial?: boolean }[] = [];
      const errors: string[] = [];

      for (let i = 0; i < results.length; i++) {
        const res = results[i];
        if (res.status === 'fulfilled') {
          successes.push(res.value);
        } else {
          errors.push(`${labels[i]} discovery unavailable. Try Refresh NFTs.`);
        }
      }

      if (!successes.length) {
        return reply.status(503).send({ error: 'NFT discovery unavailable' });
      }

      const allNfts: any[] = [];
      for (const s of successes) {
        allNfts.push(...(s.nfts || []));
      }

      const partial = successes.length !== results.length || successes.some(s => s.partial);

      // Filter again if a wallet was removed while discovery was in flight
      const current = new Set(linkedWallets(context, pid).map(a => a.toLowerCase()));
      const filteredNfts = allNfts.filter(nft => nft.wallet && current.has(nft.wallet.toLowerCase()));

      return reply.status(200).send({
        addresses: addresses.filter(addr => current.has(addr.toLowerCase())),
        nfts: filteredNfts,
        errors,
        partial,
      });
    } catch (err: any) {
      if (err?.message === 'Link a wallet first') {
        return reply.status(400).send({ error: err.message });
      }
      return reply.status(503).send({ error: 'NFT discovery is temporarily unavailable' });
    }
  });

  // Handler for POST /api/featured/hood-turtle and POST /api/featured/companion
  async function handleFeaturedCompanion(request: FastifyRequest, reply: FastifyReply) {
    try {
      const body = request.body as Record<string, unknown> | null;
      if (!body || typeof body !== 'object') {
        return reply.status(400).send({ error: 'Device credential not recognized' });
      }

      const pid = tokenPet(context, body.token);
      const addresses = linkedWallets(context, pid);
      if (!addresses.length) {
        return reply.status(403).send({ error: 'Link your wallet first' });
      }

      const urlPath = request.url.split('?')[0];
      const isCompanion = urlPath === '/api/featured/companion';

      const collection = String(body.originalAddress ?? HOOD_TURTLE_COLLECTION).toLowerCase();
      const robot = isCompanion && collection === ROBOTS_CONTRACT.toLowerCase();
      const extra = isCompanion && Boolean(EXTRA_COLLECTIONS[collection]);

      if (collection !== HOOD_TURTLE_COLLECTION.toLowerCase() && !robot && !extra) {
        return reply.status(400).send({ error: 'Unsupported companion collection' });
      }

      const expectedChain = extra
        ? EXTRA_COLLECTIONS[collection][0]
        : robot
        ? ROBOTS_CHAIN_ID
        : HOOD_TURTLE_CHAIN_ID;

      if (Number(body.chainId ?? expectedChain) !== expectedChain) {
        return reply.status(400).send({ error: 'Wrong companion chain' });
      }

      let tokenId: number;
      if (extra) {
        tokenId = Number(body.tokenId);
      } else if (robot) {
        tokenId = validateRobotTokenId(body.tokenId);
      } else {
        tokenId = turtleId(body.tokenId);
      }

      let data: any = null;
      for (const address of addresses) {
        if (extra) {
          data = await context.extraCompanionsVerifier.read(address, tokenId, collection);
        } else if (robot) {
          data = await context.robotsVerifier.read(address, tokenId);
        } else {
          data = await context.turtleOwnership.read(address, tokenId);
        }
        if (data?.active) {
          break;
        }
      }

      const current = new Set(linkedWallets(context, pid).map(a => a.toLowerCase()));
      if (!data || !current.has(String(data.wallet ?? '').toLowerCase())) {
        return reply.status(403).send({ error: 'Wallet link changed. Please try again.' });
      }

      return reply.status(200).send(data);
    } catch (err: any) {
      const msg = err?.message ?? 'Request failed';
      if (
        msg.includes('Unsupported companion collection') ||
        msg.includes('Wrong companion chain') ||
        msg.includes('Invalid Robots v1 token number') ||
        msg.includes('Enter a Hood Turtle token number')
      ) {
        return reply.status(400).send({ error: msg });
      }
      return reply.status(503).send({ error: 'Collection RPC unavailable' });
    }
  }

  app.post('/api/featured/hood-turtle', handleFeaturedCompanion);
  app.post('/api/featured/companion', handleFeaturedCompanion);
}
