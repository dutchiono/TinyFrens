import { DatabaseConnection } from '../connection.js';
import { PetRepository } from './pets.js';
import { AccountRepository } from './accounts.js';
import { WalletRepository } from './wallets.js';
import { DeviceSyncRepository } from './device-sync.js';
import { EconomyRepository } from './economy.js';
import { VoteRepository } from './votes.js';
import { AdminRepository } from './admin.js';
import { RobotRepository } from './robots.js';
import { TelegramRepository } from './telegram.js';
import { EnergyRepository } from './energy.js';

export * from './pets.js';
export * from './accounts.js';
export * from './wallets.js';
export * from './device-sync.js';
export * from './economy.js';
export * from './votes.js';
export * from './admin.js';
export * from './robots.js';
export * from './telegram.js';
export * from './energy.js';

export interface Repositories {
  pets: PetRepository;
  accounts: AccountRepository;
  wallets: WalletRepository;
  deviceSync: DeviceSyncRepository;
  economy: EconomyRepository;
  votes: VoteRepository;
  admin: AdminRepository;
  robots: RobotRepository;
  telegram: TelegramRepository;
  energy: EnergyRepository;
}

export function createRepositories(db: DatabaseConnection): Repositories {
  return {
    pets: new PetRepository(db),
    accounts: new AccountRepository(db),
    wallets: new WalletRepository(db),
    deviceSync: new DeviceSyncRepository(db),
    economy: new EconomyRepository(db),
    votes: new VoteRepository(db),
    admin: new AdminRepository(db),
    robots: new RobotRepository(db),
    telegram: new TelegramRepository(db),
    energy: new EnergyRepository(db),
  };
}
