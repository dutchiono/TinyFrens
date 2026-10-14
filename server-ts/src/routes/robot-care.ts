import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AppContext } from '../context.js';
import { tokenPet } from '../domain/account.js';
import { validateRobotTokenId } from '../domain/robot-care-rules.js';
import { UnknownAction, NotLinked } from '../domain/robot-care.js';
import { getTreasurySettings } from './economy.js';

interface CareRequestBody {
  token?: string;
  tokenId?: number | string;
  action?: string;
  game?: string;
}

export function registerRobotCareRoutes(app: FastifyInstance, context: AppContext): void {
  async function parseRobotRequest(request: FastifyRequest): Promise<{ pid: string; tid: number; body: CareRequestBody }> {
    const body = request.body as CareRequestBody;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new Error('Bad request');
    }
    if (!('tokenId' in body)) {
      throw new Error('Missing tokenId');
    }
    const pid = tokenPet(context, body.token);
    const tid = validateRobotTokenId(body.tokenId);
    return { pid, tid, body };
  }

  async function checkRobotOwnership(pid: string, tid: number): Promise<string> {
    const addresses = context.repos.wallets.getLinkedWallets(pid);
    if (!addresses || addresses.length === 0) {
      throw new NotLinked('Link your wallet first');
    }
    for (const address of addresses) {
      if (await context.robotsVerifier.ownerOf(address, tid)) {
        return address;
      }
    }
    throw new Error('You do not own this robot');
  }

  // POST /api/robots/care
  app.post('/api/robots/care', async (request: FastifyRequest, reply: FastifyReply) => {
    let pid: string;
    let tid: number;
    try {
      const parsed = await parseRobotRequest(request);
      pid = parsed.pid;
      tid = parsed.tid;
      context.rateLimiter.limit(`robot-care-status:${pid}`, 120, 3600, context.now());
    } catch (err: any) {
      return reply.status(400).send({ error: err.message || 'Bad request' });
    }

    try {
      await checkRobotOwnership(pid, tid);
    } catch (err: any) {
      if (err instanceof NotLinked || err.message === 'Link your wallet first') {
        return reply.status(403).send({ error: 'Link your wallet first' });
      }
      if (err.message === 'You do not own this robot') {
        return reply.status(403).send({ error: 'You do not own this robot' });
      }
      return reply.status(503).send({ error: 'Robot care unavailable' });
    }

    try {
      const data: any = context.robotCare.status(pid);
      data.tokenId = tid;

      const deposit = getTreasurySettings(context);
      data.deposit = {
        enabled: Boolean(deposit.enabled && deposit.address && context.economy),
        chainId: deposit.chainId ?? 8453,
        token: deposit.token,
        address: deposit.enabled && context.economy ? deposit.address : null,
      };

      return reply.status(200).send(data);
    } catch {
      return reply.status(503).send({ error: 'Robot care unavailable' });
    }
  });

  // POST /api/robots/care/action
  app.post('/api/robots/care/action', async (request: FastifyRequest, reply: FastifyReply) => {
    let pid: string;
    let tid: number;
    let body: CareRequestBody;
    try {
      const parsed = await parseRobotRequest(request);
      pid = parsed.pid;
      tid = parsed.tid;
      body = parsed.body;
      context.rateLimiter.limit(`robot-care:${pid}`, 120, 3600, context.now());
    } catch (err: any) {
      return reply.status(400).send({ error: err.message || 'Bad request' });
    }

    try {
      await checkRobotOwnership(pid, tid);
    } catch (err: any) {
      if (err instanceof NotLinked || err.message === 'Link your wallet first') {
        return reply.status(403).send({ error: 'Link your wallet first' });
      }
      if (err.message === 'You do not own this robot') {
        return reply.status(403).send({ error: 'You do not own this robot' });
      }
      return reply.status(503).send({ error: 'Robot care unavailable' });
    }

    const action = String(body.action || '').trim().toLowerCase();
    try {
      const result = context.robotCare.consume(pid, action);
      (result as any).tokenId = tid;
      return reply.status(200).send(result);
    } catch (err) {
      if (err instanceof UnknownAction) {
        return reply.status(400).send({ error: 'Unknown care action' });
      }
      return reply.status(503).send({ error: 'Robot care unavailable' });
    }
  });

  // POST /api/robots/game
  app.post('/api/robots/game', async (request: FastifyRequest, reply: FastifyReply) => {
    let pid: string;
    let tid: number;
    let body: CareRequestBody;
    try {
      const parsed = await parseRobotRequest(request);
      pid = parsed.pid;
      tid = parsed.tid;
      body = parsed.body;
      context.rateLimiter.limit(`robot-game:${pid}`, 60, 3600, context.now());
    } catch (err: any) {
      return reply.status(400).send({ error: err.message || 'Bad request' });
    }

    try {
      await checkRobotOwnership(pid, tid);
    } catch (err: any) {
      if (err instanceof NotLinked || err.message === 'Link your wallet first') {
        return reply.status(403).send({ error: 'Link your wallet first' });
      }
      if (err.message === 'You do not own this robot') {
        return reply.status(403).send({ error: 'You do not own this robot' });
      }
      return reply.status(503).send({ error: 'Robot game reward unavailable' });
    }

    const game = String(body.game || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '')
      .slice(0, 40);

    if (!game) {
      return reply.status(400).send({ error: 'Unknown game' });
    }

    try {
      const rewardCredits = Math.floor(
        Number(context.robotCareSettings?.()?.gameRewardCredits ?? 0)
      );

      if (!context.economy || rewardCredits <= 0) {
        return reply.status(200).send({
          tokenId: tid,
          game,
          granted: 0,
          balance: context.economy ? context.economy.balance(pid) : null,
        });
      }

      context.economy.grant(pid, rewardCredits, 'game', 'game', game);
      return reply.status(200).send({
        tokenId: tid,
        game,
        granted: rewardCredits,
        balance: context.economy.balance(pid),
        creditsPerFrens: context.economy.creditsPerFrens,
      });
    } catch {
      return reply.status(503).send({ error: 'Robot game reward unavailable' });
    }
  });
}
