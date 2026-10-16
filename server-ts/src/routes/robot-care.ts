import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AppContext } from '../context.js';
import { tokenPet } from '../domain/account.js';
import { verifiedAccountRobotInventory } from '../domain/account-robot-inventory.js';
import { NotLinked } from '../domain/robot-care.js';
import { isCareAction, validateRobotTokenId } from '../domain/robot-care-rules.js';
import type { CareAction } from '../domain/robot-care-rules.js';
import { InsufficientEnergy, MILLI_ENERGY } from '../domain/player-energy.js';
import type { EnergyPolicy, EnergyStatus } from '../domain/player-energy.js';
import { linkedWallets } from '../domain/wallet-link.js';

interface CareRequestBody {
  token?: string;
  tokenId?: number | string;
  action?: string;
  game?: string;
}

function energyPolicy(context: AppContext): EnergyPolicy {
  return {
    version: context.config.ENERGY_POLICY_VERSION,
    accountBasePerDayMilli: context.config.ENERGY_BASE_PER_DAY * MILLI_ENERGY,
    perRobotPerDayMilli: context.config.ENERGY_PER_ROBOT_PER_DAY * MILLI_ENERGY,
    capacityDays: context.config.ENERGY_CAPACITY_DAYS,
  };
}

function actionCosts(context: AppContext): Record<CareAction, number> {
  return {
    feed: context.config.ROBOT_ENERGY_COST_FEED * MILLI_ENERGY,
    play: context.config.ROBOT_ENERGY_COST_PLAY * MILLI_ENERGY,
    rest: context.config.ROBOT_ENERGY_COST_REST * MILLI_ENERGY,
    adventure: context.config.ROBOT_ENERGY_COST_ADVENTURE * MILLI_ENERGY,
    clean: context.config.ROBOT_ENERGY_COST_CLEAN * MILLI_ENERGY,
    vitamin: context.config.ROBOT_ENERGY_COST_VITAMIN * MILLI_ENERGY,
    scold: context.config.ROBOT_ENERGY_COST_SCOLD * MILLI_ENERGY,
    revive: context.config.ROBOT_ENERGY_COST_REVIVE * MILLI_ENERGY,
  };
}

function energyPayload(status: EnergyStatus) {
  return {
    rechargeableMilli: status.rechargeableMilli,
    purchasedMilli: status.purchasedMilli,
    totalMilli: status.totalMilli,
    ratePerDayMilli: status.ratePerDayMilli,
    capacityMilli: status.capacityMilli,
    eligibleRobots: status.eligibleRobots,
    rateVersion: status.rateVersion,
    accruedThrough: status.accruedThrough,
  };
}

export function registerRobotCareRoutes(app: FastifyInstance, context: AppContext): void {
  async function parseRobotRequest(request: FastifyRequest): Promise<{ pid: string; tid: number; body: CareRequestBody }> {
    const body = request.body as CareRequestBody;
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Bad request');
    if (!('tokenId' in body)) throw new Error('Missing tokenId');
    return { pid: tokenPet(context, body.token), tid: validateRobotTokenId(body.tokenId), body };
  }

  async function checkRobotOwnership(pid: string, tid: number): Promise<void> {
    const addresses = linkedWallets(context, pid);
    if (addresses.length === 0) throw new NotLinked('Link your wallet first');
    for (const address of addresses) {
      if (await context.robotsVerifier.ownerOf(address, tid)) return;
    }
    throw new Error('You do not own this robot');
  }

  async function verifiedEnergy(pid: string, tid: number) {
    await checkRobotOwnership(pid, tid);
    const inventory = await verifiedAccountRobotInventory(context, pid);
    if (!inventory.tokenIds.includes(tid)) throw new Error('Verified Robot inventory is inconsistent');
    const status = context.playerEnergy.status(
      inventory.account,
      inventory.tokenIds.length,
      energyPolicy(context)
    );
    return { inventory, status };
  }

  function ownershipError(reply: FastifyReply, err: any) {
    if (err instanceof NotLinked || err?.message === 'Link your wallet first') {
      return reply.status(403).send({ error: 'Link your wallet first' });
    }
    if (err?.message === 'You do not own this robot') {
      return reply.status(403).send({ error: 'You do not own this robot' });
    }
    return reply.status(503).send({ error: 'Robot Energy unavailable' });
  }

  app.post('/api/robots/care', async (request: FastifyRequest, reply: FastifyReply) => {
    let pid: string;
    let tid: number;
    try {
      ({ pid, tid } = await parseRobotRequest(request));
      context.rateLimiter.limit(`robot-care-status:${pid}`, 120, 3600, context.now());
    } catch (err: any) {
      return reply.status(400).send({ error: err.message || 'Bad request' });
    }

    try {
      const { status } = await verifiedEnergy(pid, tid);
      return reply.status(200).send({ tokenId: tid, energy: energyPayload(status), costsMilli: actionCosts(context) });
    } catch (err: any) {
      return ownershipError(reply, err);
    }
  });

  app.post('/api/robots/care/action', async (request: FastifyRequest, reply: FastifyReply) => {
    let pid: string;
    let tid: number;
    let body: CareRequestBody;
    try {
      ({ pid, tid, body } = await parseRobotRequest(request));
      context.rateLimiter.limit(`robot-care:${pid}`, 120, 3600, context.now());
    } catch (err: any) {
      return reply.status(400).send({ error: err.message || 'Bad request' });
    }

    const action = String(body.action || '').trim().toLowerCase();
    if (!isCareAction(action)) return reply.status(400).send({ error: 'Unknown care action' });

    try {
      const { inventory } = await verifiedEnergy(pid, tid);
      const costMilli = actionCosts(context)[action];
      try {
        const status = context.playerEnergy.spend(
          inventory.account,
          inventory.tokenIds.length,
          costMilli,
          'care',
          'care-action',
          action,
          energyPolicy(context)
        );
        return reply.status(200).send({
          allowed: true,
          tokenId: tid,
          action,
          costMilli,
          energy: energyPayload(status),
        });
      } catch (err) {
        if (!(err instanceof InsufficientEnergy)) throw err;
        const status = context.playerEnergy.status(
          inventory.account,
          inventory.tokenIds.length,
          energyPolicy(context)
        );
        return reply.status(200).send({
          allowed: false,
          insufficientEnergy: true,
          tokenId: tid,
          action,
          costMilli,
          energy: energyPayload(status),
        });
      }
    } catch (err: any) {
      return ownershipError(reply, err);
    }
  });

  // Older clients still report completion here. Ordinary completions no longer
  // mint credits; a separately budgeted rare FRENS roll can be added later.
  app.post('/api/robots/game', async (request: FastifyRequest, reply: FastifyReply) => {
    let pid: string;
    let tid: number;
    let body: CareRequestBody;
    try {
      ({ pid, tid, body } = await parseRobotRequest(request));
      context.rateLimiter.limit(`robot-game:${pid}`, 60, 3600, context.now());
    } catch (err: any) {
      return reply.status(400).send({ error: err.message || 'Bad request' });
    }

    const game = String(body.game || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40);
    if (!game) return reply.status(400).send({ error: 'Unknown game' });

    try {
      const { status } = await verifiedEnergy(pid, tid);
      return reply.status(200).send({ tokenId: tid, game, granted: 0, energy: energyPayload(status) });
    } catch (err: any) {
      return ownershipError(reply, err);
    }
  });
}
