import { AppContext } from '../context.js';
import { linkedWallets } from './wallet-link.js';
import { EXTRA_COLLECTIONS, ROBOTS_CONTRACT } from './companion-verifier.js';
import { getDeviceSyncSnapshot } from './device-sync.js';
import { HOOD_TURTLE_COLLECTION } from './turtle-ownership.js';
import { replyMarkup } from '../integrations/telegram.js';
import { companionGif, TelegramCompanionRig } from '../media/telegram-gif.js';

export interface VerifiedTelegramCompanion {
  active: boolean;
  chainId: number;
  originalAddress: string;
  tokenId: number;
  name: string;
  companion: TelegramCompanionRig;
}

export async function communityCompanion(
  context: AppContext,
  petId: string,
  position = 1
): Promise<VerifiedTelegramCompanion> {
  const snapshot = getDeviceSyncSnapshot(context, petId);
  if (snapshot.telegramSelection.length === 0) {
    throw new Error('No community-bot slots are selected. Open TinyFrens and choose Show in community bots first');
  }
  const item = snapshot.telegramSelection.find(
    value => Number((value as Record<string, unknown>).slot) === position
  ) as Record<string, unknown> | undefined;
  if (!item) throw new Error(`Telegram slot ${position} is empty. Choose it in TinyFrens first`);
  const collection = String(item.originalAddress || '').toLowerCase();
  const tokenId = Number(item.tokenId);
  const addresses = linkedWallets(context, petId);
  if (addresses.length === 0) throw new Error('Link a wallet first');
  const isRobot = collection === ROBOTS_CONTRACT;
  const isExtra = Object.hasOwn(EXTRA_COLLECTIONS, collection);
  if (collection !== HOOD_TURTLE_COLLECTION && !isRobot && !isExtra) {
    throw new Error('That collection is not supported');
  }
  let data: Record<string, any> | null = null;
  for (const address of addresses) {
    if (isExtra) data = await context.extraCompanionsVerifier.read(address, tokenId, collection);
    else if (isRobot) data = await context.robotsVerifier.read(address, tokenId);
    else data = await context.turtleOwnership.read(address, tokenId, false, context.now()) as unknown as Record<string, any>;
    if (data?.active) break;
  }
  if (!data?.active || !data.companion) throw new Error('TinyFrens could not verify that NFT right now');
  return data as VerifiedTelegramCompanion;
}

export const telegramCompanion = communityCompanion;

export async function sendTelegramCompanion(
  context: AppContext,
  chatId: unknown,
  petId: string,
  position: number,
  token: string,
  isPrivate: boolean
): Promise<void> {
  const data = await communityCompanion(context, petId, position);
  const collection = data.originalAddress.toLowerCase();
  const cached = context.repos.telegram.getCachedMediaFileId(data.chainId, collection, data.tokenId);
  const miniapp = context.config.TELEGRAM_MINIAPP_URL.split('#', 1)[0];
  const deepLink = context.config.TELEGRAM_MINIAPP_DEEP_LINK || 'https://t.me/TinyFrensBot?startapp=home';
  const payload: Record<string, unknown> = {
    chat_id: chatId,
    animation: cached || 'attach://animation',
    caption: String(data.name).slice(0, 900),
    reply_markup: replyMarkup(isPrivate ? `${miniapp}#pet` : deepLink, '🐾 Open TinyFrens', isPrivate),
  };
  const response = cached
    ? await context.telegramApi.call('sendAnimation', payload, token)
    : await context.telegramApi.call('sendAnimation', payload, token, {
      animation: {
        data: companionGif(data.companion),
        filename: 'animation.gif',
        contentType: 'image/gif',
      },
    });
  if (response.status >= 400 || !response.data || response.data.ok !== true) {
    throw new Error('Telegram could not post the NFT animation');
  }
  const result = response.data.result;
  const animation = result && typeof result === 'object' ? (result as Record<string, unknown>).animation : null;
  const fileId = animation && typeof animation === 'object' ? (animation as Record<string, unknown>).file_id : null;
  if (!cached && typeof fileId === 'string' && fileId) {
    context.repos.telegram.setCachedMediaFileId(
      data.chainId,
      collection,
      data.tokenId,
      fileId,
      Math.floor(context.now())
    );
  }
}
