import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AppContext } from '../context.js';
import { tokenPet } from '../domain/account.js';
import { parseFrensToCredits } from '../domain/economy-math.js';
import { InsufficientCredits } from '../domain/economy.js';
import { getClientIp } from '../rate-limit.js';
import { getTreasurySettings } from './economy.js';

export function registerCollectionRoutes(app: FastifyInstance, context: AppContext): void {
  // Collection suggestions listing
  app.get('/api/collections/suggestions', async (_request: FastifyRequest, reply: FastifyReply) => {
    const rows = context.repos.votes.listSuggestionsWithVotes();
    const per = context.economy?.creditsPerFrens ?? 100;

    const collections = rows.map(row => {
      const credits = row.total_credits;
      const frens =
        credits % per
          ? Math.round((credits / per) * 10000) / 10000
          : Math.floor(credits / per);

      return {
        id: row.id,
        chainId: row.chain_id,
        address: row.address,
        name: row.name,
        created: row.created,
        credits,
        votes: row.vote_count,
        frens,
      };
    });

    return reply.status(200).send({ collections });
  });

  // Submit collection suggestion
  app.post('/api/collections/suggestions', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = request.body as Record<string, unknown> | null;
      if (!body || typeof body !== 'object') {
        throw new Error('Bad request');
      }

      const pid = tokenPet(context, body.token);
      const chain = body.chainId;
      if (typeof chain !== 'number' || !Number.isInteger(chain) || chain < 1 || chain > 2147483647) {
        throw new Error('Choose a network or enter a valid chain ID.');
      }

      const address = body.address;
      if (
        typeof address !== 'string' ||
        !/^0x[0-9a-fA-F]{40}$/.test(address) ||
        BigInt(address) === 0n
      ) {
        throw new Error(
          'Enter the NFT collection contract address (0x followed by 40 hexadecimal characters).'
        );
      }
      const addrLower = address.toLowerCase();

      const rawName = body.name ?? '';
      if (
        typeof rawName !== 'string' ||
        rawName.trim().length > 100 ||
        Array.from(rawName).some(c => c.charCodeAt(0) < 32)
      ) {
        throw new Error('Collection name must be 100 characters or fewer.');
      }
      const cleanNameStr = rawName.trim();

      const existing = context.repos.votes.getSuggestionByAddress(chain, addrLower);
      if (existing) {
        return reply.status(200).send({
          collection: {
            id: existing.id,
            chainId: existing.chain_id,
            address: existing.address,
            name: existing.name,
            created: existing.created,
            credits: 0,
            votes: 0,
            frens: 0,
          },
          existing: true,
        });
      }

      const ip = getClientIp(request, context.config.TRUST_PROXY);
      context.rateLimiter.limit(`collection-suggestion:${pid}`, 5, 86400, context.now());
      context.rateLimiter.limit(`collection-suggestion-ip:${ip}`, 20, 3600, context.now());

      if (context.repos.votes.countSuggestions() >= 500) {
        throw new Error('Suggestions are full for now. Please try again later.');
      }

      const nowSec = Math.floor(context.now());
      const newId = context.repos.votes.createSuggestion(chain, addrLower, cleanNameStr, nowSec);
      const createdRow = context.repos.votes.getSuggestionById(newId);

      return reply.status(201).send({
        collection: {
          id: createdRow!.id,
          chainId: createdRow!.chain_id,
          address: createdRow!.address,
          name: createdRow!.name,
          created: createdRow!.created,
          credits: 0,
          votes: 0,
          frens: 0,
        },
        existing: false,
      });
    } catch (e: any) {
      return reply.status(400).send({ error: e.message || 'Bad request' });
    }
  });

  // Vote on collection suggestion
  app.post('/api/collections/vote', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = request.body as Record<string, unknown> | null;
      if (!body || typeof body !== 'object') {
        throw new Error('Bad request');
      }

      const pid = tokenPet(context, body.token);
      if (!context.economy) {
        return reply.status(503).send({ error: 'Economy is not enabled on this server' });
      }

      const cid = body.collectionId;
      if (typeof cid !== 'number' || !Number.isInteger(cid) || cid <= 0) {
        throw new Error('Select a valid collection to vote on');
      }

      const coll = context.repos.votes.getSuggestionById(cid);
      if (!coll) {
        throw new Error('Collection suggestion not found');
      }

      const { credits, cleanAmount } = parseFrensToCredits(body.amount, context.economy.creditsPerFrens);

      const ip = getClientIp(request, context.config.TRUST_PROXY);
      context.rateLimiter.limit(`collection-vote:${pid}`, 60, 3600, context.now());
      context.rateLimiter.limit(`collection-vote-ip:${ip}`, 120, 3600, context.now());

      try {
        const remaining = context.economy.spend(pid, credits, 'vote', 'collection', String(cid));
        const nowSec = Math.floor(context.now());
        context.repos.votes.recordVote(cid, pid, credits, cleanAmount, nowSec);

        return reply
          .header('Cache-Control', 'no-store')
          .status(200)
          .send({
            success: true,
            collectionId: cid,
            collectionName: coll.name,
            creditsBurned: credits,
            frensBurned: cleanAmount,
            balance: remaining,
            creditsPerFrens: context.economy.creditsPerFrens,
          });
      } catch (e: any) {
        if (e instanceof InsufficientCredits) {
          const curBalance = context.economy.balance(pid);
          return reply
            .header('Cache-Control', 'no-store')
            .status(400)
            .send({
              error: 'Insufficient deposited FRENS balance',
              balance: curBalance,
              creditsPerFrens: context.economy.creditsPerFrens,
              requiredCredits: credits,
              shortfallCredits: Math.max(0, credits - curBalance),
            });
        }
        throw e;
      }
    } catch (e: any) {
      return reply
        .header('Cache-Control', 'no-store')
        .status(400)
        .send({ error: e.message || 'Bad request' });
    }
  });

  // Vote status endpoint (POST & GET)
  const voteStatusHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    let balance = 0;
    try {
      let token: unknown = undefined;
      if (request.body && typeof request.body === 'object') {
        token = (request.body as Record<string, unknown>).token;
      }
      if (!token && request.query && typeof request.query === 'object') {
        token = (request.query as Record<string, unknown>).token;
      }
      if (typeof token === 'string' && token.trim()) {
        const pid = tokenPet(context, token);
        balance = context.economy ? context.economy.balance(pid) : 0;
      }
    } catch {
      balance = 0;
    }

    const dep = getTreasurySettings(context);
    const economyEnabled = Boolean(context.economy);
    const depositInfo = {
      enabled: Boolean(dep.enabled && dep.address && economyEnabled),
      address: dep.enabled && economyEnabled ? dep.address : null,
      chainId: dep.chainId || 8453,
      token: dep.token || '0x1A96226727a1D0a46334b3A4b3878B32B7659ba3',
    };

    return reply
      .header('Cache-Control', 'no-store')
      .status(200)
      .send({
        balance,
        creditsPerFrens: context.economy ? context.economy.creditsPerFrens : 100,
        deposit: depositInfo,
      });
  };

  app.get('/api/vote/status', voteStatusHandler);
  app.post('/api/vote/status', voteStatusHandler);
}
