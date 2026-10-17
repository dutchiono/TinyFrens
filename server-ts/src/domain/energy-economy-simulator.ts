export interface DiminishingBoostPolicy {
  thresholdFrens: number;
  boostBpsPerDoubling: number;
  maxBoostBps: number;
}

export interface EnergySimulatorPolicy {
  accountBasePerDay: number;
  perRobotPerDay: number;
  capacityDays: number;
  sessionHours: number;
  averageActionCost: number;
  minimumActionCost: number;
  maximumActionCost: number;
  liquid: DiminishingBoostPolicy;
  staked: DiminishingBoostPolicy;
  burned: DiminishingBoostPolicy;
}

export interface EnergyScenario {
  label: string;
  robots: number;
  liquidFrens: number;
  stakedFrens: number;
  burnedFrens: number;
}

export interface EnergySimulation {
  label: string;
  robots: number;
  basePerDay: number;
  liquidBoostBps: number;
  stakingBoostBps: number;
  burnBoostBps: number;
  totalBoostBps: number;
  multiplier: number;
  energyPerDay: number;
  energyPerSession: number;
  capacity: number;
  averageActionsPerSession: number;
  minimumCostActionsPerSession: number;
  maximumCostActionsPerSession: number;
}

export interface FeeSplitInput {
  weeklyFeesFrens: number;
  stakerShareBps: number;
  totalStakedFrens: number;
  accountStakedFrens: number;
}

export interface FeeSplitSimulation {
  projectFrensPerWeek: number;
  stakerPoolFrensPerWeek: number;
  pendingFrensPerWeek: number;
  accountFrensPerWeek: number;
  accountSharePercent: number;
  simpleAnnualRewardPercent: number;
}

export const DRAFT_ENERGY_SIMULATOR_POLICY: EnergySimulatorPolicy = {
  accountBasePerDay: 18,
  perRobotPerDay: 6,
  capacityDays: 3,
  sessionHours: 6,
  averageActionCost: 5.5,
  minimumActionCost: 4,
  maximumActionCost: 7,
  liquid: {
    thresholdFrens: 1_000,
    boostBpsPerDoubling: 500,
    maxBoostBps: 7_500,
  },
  staked: {
    thresholdFrens: 1_000,
    boostBpsPerDoubling: 1_000,
    maxBoostBps: 15_000,
  },
  burned: {
    thresholdFrens: 1_000,
    boostBpsPerDoubling: 1_500,
    maxBoostBps: 22_500,
  },
};

function finiteNonNegative(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be finite and non-negative`);
  return value;
}

function positive(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be finite and positive`);
  return value;
}

function basisPoints(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 100_000) {
    throw new Error(`${label} must be an integer from 0 to 100000 basis points`);
  }
  return value;
}

function validateBoostPolicy(policy: DiminishingBoostPolicy, label: string): DiminishingBoostPolicy {
  return {
    thresholdFrens: positive(policy.thresholdFrens, `${label} threshold`),
    boostBpsPerDoubling: basisPoints(policy.boostBpsPerDoubling, `${label} boost`),
    maxBoostBps: basisPoints(policy.maxBoostBps, `${label} cap`),
  };
}

export function diminishingBoostBps(amountFrens: number, rawPolicy: DiminishingBoostPolicy): number {
  const amount = finiteNonNegative(amountFrens, 'FRENS amount');
  const policy = validateBoostPolicy(rawPolicy, 'Boost');
  if (amount === 0 || policy.boostBpsPerDoubling === 0 || policy.maxBoostBps === 0) return 0;
  return Math.min(
    policy.maxBoostBps,
    policy.boostBpsPerDoubling * Math.log2(1 + amount / policy.thresholdFrens)
  );
}

export function simulateEnergyScenario(
  scenario: EnergyScenario,
  rawPolicy: EnergySimulatorPolicy = DRAFT_ENERGY_SIMULATOR_POLICY
): EnergySimulation {
  const robots = finiteNonNegative(scenario.robots, 'Robot count');
  if (!Number.isSafeInteger(robots)) throw new Error('Robot count must be a safe integer');
  const policy: EnergySimulatorPolicy = {
    accountBasePerDay: finiteNonNegative(rawPolicy.accountBasePerDay, 'Account base'),
    perRobotPerDay: finiteNonNegative(rawPolicy.perRobotPerDay, 'Per-Robot rate'),
    capacityDays: positive(rawPolicy.capacityDays, 'Capacity days'),
    sessionHours: positive(rawPolicy.sessionHours, 'Session hours'),
    averageActionCost: positive(rawPolicy.averageActionCost, 'Average action cost'),
    minimumActionCost: positive(rawPolicy.minimumActionCost, 'Minimum action cost'),
    maximumActionCost: positive(rawPolicy.maximumActionCost, 'Maximum action cost'),
    liquid: validateBoostPolicy(rawPolicy.liquid, 'Liquid'),
    staked: validateBoostPolicy(rawPolicy.staked, 'Staked'),
    burned: validateBoostPolicy(rawPolicy.burned, 'Burned'),
  };
  if (policy.minimumActionCost > policy.maximumActionCost) {
    throw new Error('Minimum action cost cannot exceed maximum action cost');
  }

  const liquidFrens = finiteNonNegative(scenario.liquidFrens, 'Liquid FRENS');
  const stakedFrens = finiteNonNegative(scenario.stakedFrens, 'Staked FRENS');
  const burnedFrens = finiteNonNegative(scenario.burnedFrens, 'Burned FRENS');
  const basePerDay = robots === 0 ? 0 : policy.accountBasePerDay + policy.perRobotPerDay * robots;
  const liquidBoostBps = robots === 0 ? 0 : diminishingBoostBps(liquidFrens, policy.liquid);
  const stakingBoostBps = robots === 0 ? 0 : diminishingBoostBps(stakedFrens, policy.staked);
  const burnBoostBps = robots === 0 ? 0 : diminishingBoostBps(burnedFrens, policy.burned);
  const totalBoostBps = liquidBoostBps + stakingBoostBps + burnBoostBps;
  const multiplier = robots === 0 ? 0 : 1 + totalBoostBps / 10_000;
  const energyPerDay = basePerDay * multiplier;
  const energyPerSession = energyPerDay * policy.sessionHours / 24;

  return {
    label: scenario.label,
    robots,
    basePerDay,
    liquidBoostBps,
    stakingBoostBps,
    burnBoostBps,
    totalBoostBps,
    multiplier,
    energyPerDay,
    energyPerSession,
    capacity: energyPerDay * policy.capacityDays,
    averageActionsPerSession: energyPerSession / policy.averageActionCost,
    minimumCostActionsPerSession: energyPerSession / policy.minimumActionCost,
    maximumCostActionsPerSession: energyPerSession / policy.maximumActionCost,
  };
}

export function simulateFeeSplit(input: FeeSplitInput): FeeSplitSimulation {
  const weeklyFees = finiteNonNegative(input.weeklyFeesFrens, 'Weekly fees');
  const totalStaked = finiteNonNegative(input.totalStakedFrens, 'Total stake');
  const accountStake = finiteNonNegative(input.accountStakedFrens, 'Account stake');
  const shareBps = basisPoints(input.stakerShareBps, 'Staker share');
  if (shareBps > 10_000) throw new Error('Staker share cannot exceed 10000 basis points');
  if (accountStake > totalStaked) throw new Error('Account stake cannot exceed total stake');

  const stakerPoolFrensPerWeek = weeklyFees * shareBps / 10_000;
  const projectFrensPerWeek = weeklyFees - stakerPoolFrensPerWeek;
  const pendingFrensPerWeek = totalStaked === 0 ? stakerPoolFrensPerWeek : 0;
  const accountSharePercent = totalStaked === 0 ? 0 : accountStake / totalStaked * 100;
  const accountFrensPerWeek = totalStaked === 0
    ? 0
    : stakerPoolFrensPerWeek * accountStake / totalStaked;
  const simpleAnnualRewardPercent = accountStake === 0
    ? 0
    : accountFrensPerWeek * 52 / accountStake * 100;

  return {
    projectFrensPerWeek,
    stakerPoolFrensPerWeek,
    pendingFrensPerWeek,
    accountFrensPerWeek,
    accountSharePercent,
    simpleAnnualRewardPercent,
  };
}
