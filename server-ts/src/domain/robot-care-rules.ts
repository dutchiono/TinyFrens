export const ROBOTS_TOKEN_MIN = 1;
export const ROBOTS_TOKEN_MAX = 2664;

export const CARE_ACTIONS = [
  'feed',
  'play',
  'rest',
  'adventure',
  'clean',
  'vitamin',
  'scold',
  'revive',
] as const;

export type CareAction = typeof CARE_ACTIONS[number];

export const DEFAULT_ENERGY_COSTS: Record<CareAction, number> = {
  feed: 4,
  play: 5,
  rest: 4,
  adventure: 7,
  clean: 4,
  vitamin: 6,
  scold: 4,
  revive: 7,
};

export const FREE_ACTIONS = ['pet'] as const;
export type FreeAction = typeof FREE_ACTIONS[number];

export const DEFAULT_PRICES_FRENS: Record<CareAction, number> = {
  feed: 1000,
  play: 1500,
  rest: 500,
  adventure: 1500,
  clean: 500,
  vitamin: 5000,
  scold: 250,
  revive: 100000,
};

export const DEFAULT_DAILY_ALLOWANCE = 24;
export const DEFAULT_GAME_REWARD_CREDITS = 0;

export function validateRobotTokenId(value: unknown): number {
  if (typeof value === 'boolean') {
    throw new Error('Invalid Robots v1 token number');
  }
  const str = String(value ?? '');
  if (!/^[0-9]{1,4}$/.test(str)) {
    throw new Error('Invalid Robots v1 token number');
  }
  const num = parseInt(str, 10);
  if (num < ROBOTS_TOKEN_MIN || num > ROBOTS_TOKEN_MAX) {
    throw new Error('Invalid Robots v1 token number');
  }
  return num;
}

export function utcDayKey(timestampSeconds: number = Date.now() / 1000): string {
  const date = new Date(timestampSeconds * 1000);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function isCareAction(action: string): action is CareAction {
  return (CARE_ACTIONS as readonly string[]).includes(action);
}

export function isFreeAction(action: string): action is FreeAction {
  return (FREE_ACTIONS as readonly string[]).includes(action);
}
