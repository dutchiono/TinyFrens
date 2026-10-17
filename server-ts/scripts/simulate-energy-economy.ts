import fs from 'node:fs';
import path from 'node:path';
import {
  EnergyScenario,
  EnergySimulatorPolicy,
  simulateEnergyScenario,
  simulateFeeSplit,
} from '../src/domain/energy-economy-simulator.js';

interface SimulatorFile {
  policy: EnergySimulatorPolicy;
  weeklyFeesFrens: number;
  stakerShareBps: number;
  totalStakedFrens: number;
  scenarios: EnergyScenario[];
}

const configPath = path.resolve(process.cwd(), process.argv[2] || '../docs/energy-economy-scenarios.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8')) as SimulatorFile;
const round = (value: number, digits = 2) => Number(value.toFixed(digits));

const energyRows = config.scenarios.map(scenario => {
  const result = simulateEnergyScenario(scenario, config.policy);
  return {
    Scenario: result.label,
    Robots: result.robots,
    'Boost %': round(result.totalBoostBps / 100, 1),
    Multiplier: `${round(result.multiplier)}x`,
    'Energy/day': round(result.energyPerDay),
    'Energy/session': round(result.energyPerSession),
    'Actions/session @ avg': round(result.averageActionsPerSession, 1),
    'Recharge cap': round(result.capacity),
  };
});

const rewardRows = config.scenarios
  .filter(scenario => scenario.stakedFrens > 0)
  .map(scenario => {
    const result = simulateFeeSplit({
      weeklyFeesFrens: config.weeklyFeesFrens,
      stakerShareBps: config.stakerShareBps,
      totalStakedFrens: config.totalStakedFrens,
      accountStakedFrens: scenario.stakedFrens,
    });
    return {
      Scenario: scenario.label,
      'Stake FRENS': scenario.stakedFrens,
      'Pool share %': round(result.accountSharePercent, 2),
      'FRENS/week': round(result.accountFrensPerWeek),
      'Simple annual reward %': round(result.simpleAnnualRewardPercent, 1),
    };
  });

console.log(`Draft Energy economy simulation: ${configPath}`);
console.table(energyRows);
console.log(`Fee model: ${config.weeklyFeesFrens} FRENS/week, ${config.stakerShareBps / 100}% to stakers, ${config.totalStakedFrens} total FRENS staked`);
console.table(rewardRows);
