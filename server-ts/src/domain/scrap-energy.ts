import type { AppContext } from '../context.js';
import { verifiedAccountRobotInventory } from './account-robot-inventory.js';
import { getScrapState, joinScrapRun, ScrapActionResult } from './telegram-scrap.js';
import { EnergyStatus, MILLI_ENERGY } from './player-energy.js';

function policy(context: AppContext) {
  return {
    version: context.config.ENERGY_POLICY_VERSION,
    accountBasePerDayMilli: context.config.ENERGY_BASE_PER_DAY * MILLI_ENERGY,
    perRobotPerDayMilli: context.config.ENERGY_PER_ROBOT_PER_DAY * MILLI_ENERGY,
    capacityDays: context.config.ENERGY_CAPACITY_DAYS,
  };
}

export interface ScrapEnergyStatus {
  status: EnergyStatus;
  costMilli: number;
  waitSeconds: number | null;
}

function waitForEnergy(status: EnergyStatus, costMilli: number): number | null {
  if (status.totalMilli >= costMilli) return 0;
  if (status.ratePerDayMilli <= 0) return null;
  return Math.ceil((costMilli - status.totalMilli) * 86_400 / status.ratePerDayMilli);
}

export async function scrapEnergyStatus(context: AppContext, petId: string): Promise<ScrapEnergyStatus> {
  const inventory = await verifiedAccountRobotInventory(context, petId);
  if (inventory.tokenIds.length === 0) {
    throw new Error('Own a verified Robots v1 NFT to join Scrap Runs.');
  }
  const costMilli = context.config.SCRAP_RUN_ENERGY_COST * MILLI_ENERGY;
  const status = context.playerEnergy.status(
    inventory.account,
    inventory.tokenIds.length,
    policy(context)
  );
  return { status, costMilli, waitSeconds: waitForEnergy(status, costMilli) };
}

export async function joinEnergyPoweredScrapRun(
  context: AppContext,
  input: { runId: string; userId: string; petId: string; displayName: string; now: number }
): Promise<ScrapActionResult> {
  const current = getScrapState(context.db, input.runId);
  if (current?.members.some(member => member.user_id === input.userId || member.pet_id === input.petId)) {
    return joinScrapRun(
      context.db, input.runId, input.userId, input.petId, input.displayName, input.now
    );
  }

  const inventory = await verifiedAccountRobotInventory(context, input.petId);
  if (inventory.tokenIds.length === 0) {
    throw new Error('Own a verified Robots v1 NFT to join Scrap Runs.');
  }
  const costMilli = context.config.SCRAP_RUN_ENERGY_COST * MILLI_ENERGY;
  return joinScrapRun(
    context.db,
    input.runId,
    input.userId,
    input.petId,
    input.displayName,
    input.now,
    () => context.playerEnergy.spend(
      inventory.account,
      inventory.tokenIds.length,
      costMilli,
      'scrap-run',
      'scrap-run',
      input.runId,
      policy(context)
    )
  );
}

export function scrapEnergyError(error: unknown): string {
  if (!(error instanceof Error)) return 'Scrap Run Energy is unavailable.';
  if (error.name !== 'InsufficientEnergy') return error.message;
  const available = Number((error as Error & { availableMilli?: number }).availableMilli || 0) / MILLI_ENERGY;
  return `You need more Energy to join. You have ${available.toFixed(1)}; check /inventory for recharge timing.`;
}
