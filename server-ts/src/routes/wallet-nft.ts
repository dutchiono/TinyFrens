import crypto from 'node:crypto';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { encodeFunctionData, parseAbi } from 'viem';
import { AppContext } from '../context.js';
import { getClientIp } from '../rate-limit.js';
import { tokenPet } from '../domain/account.js';
import { calculateEthMintQuote } from './nft.js';
import {
  NFT_MAX_SUPPLY,
  VALID_CUSTOM_ACCESSORIES,
  VALID_CUSTOM_EXPRESSIONS,
  nftTraitsById,
} from '../domain/nft-traits.js';
import { frenVaultAddressAndKey } from '../crypto/vault.js';
import { sendVaultTx, chainNamePayload } from '../domain/vault-tx.js';
import { creditsFromWei } from '../domain/economy-math.js';

interface WalletMintBody {
  token?: string;
  mode?: string;
  checkOnly?: boolean;
  customTraits?: Record<string, any>;
  traits?: Record<string, any>;
  name?: string;
}

interface WalletRenameBody {
  token?: string;
  tokenId?: number | string;
  name?: string;
}

interface WalletEvolveBody {
  token?: string;
  tokenId?: number | string;
}

interface WalletUnwrapBody {
  token?: string;
  tokenId?: number | string;
}

interface WalletSaveNftChangesBody {
  token?: string;
  tokenId?: number | string;
  name?: string;
  customTraits?: Record<string, any>;
  traits?: Record<string, any>;
}

interface WalletMagicLinkBody {
  token?: string;
}

interface WalletRestoreBody {
  code?: string;
}

function parseTokenId(raw: unknown): number {
  const tid = parseInt(String(raw || 0), 10);
  if (isNaN(tid) || tid < 1 || tid > NFT_MAX_SUPPLY) {
    throw new Error('Choose a TinyFren token first.');
  }
  return tid;
}

export function registerWalletNftRoutes(app: FastifyInstance, context: AppContext): void {
  // POST /api/wallet/mint
  app.post('/api/wallet/mint', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const ip = getClientIp(request, context.config.TRUST_PROXY);
      context.rateLimiter.limit(`wallet-mint:${ip}`, 20, 3600, context.now());

      const body = request.body as WalletMintBody | null;
      if (!body || typeof body !== 'object') {
        return reply.status(400).send({ error: 'Device credential not recognized' });
      }

      const pid = tokenPet(context, body.token);
      const { address: evmAddr } = frenVaultAddressAndKey(pid, context.config.FREN_VAULT_SEED);
      const quote = calculateEthMintQuote(context);
      const mode = String(body.mode || 'eth').toLowerCase();
      const isVault = mode === 'vault';
      const vaultFrens = isVault ? String(quote.vaultFrensRequired) : '0';

      if (body.checkOnly) {
        return reply.status(200).send({
          canAfford: true,
          mode,
          ethRequired: !isVault ? quote.ethRequired : 0,
          ethRequiredWei: !isVault ? quote.ethRequiredWei : '0',
          vaultFrensRequired: vaultFrens,
          vaultAddress: evmAddr,
          quote,
        });
      }

      const allowFree = context.config.ALLOW_TESTNET_FREE_MINT;
      if (!allowFree && !isVault) {
        return reply.status(402).send({
          error: `Minting requires ${(quote.ethRequired as number).toFixed(6)} ETH on Base. Send ETH to your wallet and mint from the on-chain collection.`,
          ethRequired: quote.ethRequired,
          ethRequiredWei: quote.ethRequiredWei,
          vaultAddress: evmAddr,
          quote,
        });
      }

      const customTraits = (body.customTraits || body.traits) as Record<string, any> | undefined;
      const requestedShape =
        customTraits && typeof customTraits === 'object'
          ? String(customTraits.shape || '').toLowerCase()
          : '';

      if (requestedShape && requestedShape !== 'robot') {
        return reply.status(400).send({ error: 'BNKR NFT minting is robot-only.' });
      }

      const usedIds = context.repos.wallets.getAllMintedTokenIds();
      const availableIds: number[] = [];
      for (let i = 1; i <= NFT_MAX_SUPPLY; i++) {
        if (!usedIds.has(i)) {
          availableIds.push(i);
        }
      }

      if (availableIds.length === 0) {
        return reply.status(409).send({ error: 'No unminted TinyFrens robots remain.' });
      }

      const randomIndex = Math.floor(context.random() * availableIds.length);
      const tokenId = availableIds[randomIndex];
      const traitsData = nftTraitsById(tokenId);

      if (customTraits && typeof customTraits === 'object') {
        const cColor = String(customTraits.color || '');
        if (/^#[0-9a-fA-F]{6}$/.test(cColor)) {
          traitsData.color = cColor.toLowerCase();
        }

        const cExpr = String(customTraits.expression || '').toLowerCase();
        if (VALID_CUSTOM_EXPRESSIONS.has(cExpr)) {
          traitsData.expression = cExpr;
          traitsData.expressionLabel = cExpr
            .replace(/_/g, ' ')
            .replace(/\b\w/g, c => c.toUpperCase());
        }

        const cAcc = String(customTraits.accessory || '').toLowerCase();
        if (VALID_CUSTOM_ACCESSORIES.has(cAcc)) {
          traitsData.accessory = cAcc;
          traitsData.accessoryLabel = cAcc
            .replace(/_/g, ' ')
            .replace(/\b\w/g, c => c.toUpperCase());
        }
      }

      if (isVault) {
        traitsData.vaultBacked = true;
        traitsData.lockedFrens = String(vaultFrens);
      }

      const speciesCapital = traitsData.shape.charAt(0).toUpperCase() + traitsData.shape.slice(1);
      const customName = String(body.name || '').trim();
      const nftName =
        customName && customName.length >= 1 && customName.length <= 20
          ? `TinyFren #${tokenId} · ${customName}`
          : `TinyFren #${tokenId} · ${speciesCapital}`;

      context.repos.wallets.insertFrenNft(
        pid,
        tokenId,
        nftName,
        JSON.stringify(traitsData),
        Math.floor(context.now()),
        String(vaultFrens)
      );

      const currentPet = context.repos.pets.findById(pid);
      if (!currentPet) {
        throw new Error('Pet not found');
      }
      const currentProfile = JSON.parse(currentPet.profile);
      const petDisplayName =
        customName && customName.length >= 1 && customName.length <= 20
          ? customName
          : currentProfile.name;

      const transformed = {
        ...currentProfile,
        ...traitsData,
        tokenId,
        name: petDisplayName,
      };

      context.repos.pets.updateProfile(pid, JSON.stringify(transformed));

      const nftObj = {
        chain: 'base',
        collection: {
          name: 'TinyFrens',
          address: context.config.TINYFRENS_NFT_ADDRESS || '0xTinyFrensNFT',
        },
        tokenId,
        name: nftName,
        traits: traitsData,
        vaultBacked: isVault,
        lockedFrens: String(vaultFrens),
      };

      return reply.status(200).send({
        success: true,
        pet: transformed,
        nft: nftObj,
        evmAddress: evmAddr,
        quote,
        mode,
      });
    } catch (err: any) {
      return reply.status(400).send({ error: err?.message || 'Could not mint TinyFren' });
    }
  });

  // POST /api/wallet/rename-nft
  app.post('/api/wallet/rename-nft', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const ip = getClientIp(request, context.config.TRUST_PROXY);
      context.rateLimiter.limit(`wallet-rename-nft:${ip}`, 20, 3600, context.now());

      const body = request.body as WalletRenameBody | null;
      if (!body || typeof body !== 'object') {
        return reply.status(400).send({ error: 'Device credential not recognized' });
      }

      const pid = tokenPet(context, body.token);
      const tokenId = parseTokenId(body.tokenId);

      const name = String(body.name || '')
        .trim()
        .replace(/\s+/g, ' ');

      if (name.length < 1 || name.length > 32 || !/^[A-Za-z0-9 !#_.?-]+$/.test(name)) {
        throw new Error('Use 1-32 letters, numbers, spaces, or ! # _ . ? -');
      }

      const nftContract = context.config.TINYFRENS_NFT_ADDRESS;
      if (!nftContract || !/^0x[a-fA-F0-9]{40}$/.test(nftContract)) {
        throw new Error('TinyFrens NFT contract is not configured.');
      }

      const data = encodeFunctionData({
        abi: parseAbi(['function rename(uint256 tokenId, string name)']),
        functionName: 'rename',
        args: [BigInt(tokenId), name],
      });

      const tx = await sendVaultTx(context, pid, nftContract, data);

      const currentPet = context.repos.pets.findById(pid);
      if (!currentPet) {
        throw new Error('Pet not found');
      }
      const currentProfile = JSON.parse(currentPet.profile);

      let updated = currentProfile;
      if (Number(currentProfile.tokenId) === tokenId) {
        updated = { ...currentProfile, name: name.slice(0, 20) };
        context.repos.pets.updateProfile(pid, JSON.stringify(updated));
      }

      return reply.status(200).send({
        ok: true,
        tokenId,
        name,
        tx,
        pet: updated,
        ...chainNamePayload(context.config.CHAIN_ID),
      });
    } catch (err: any) {
      return reply.status(400).send({ error: err?.message || 'Could not rename TinyFren' });
    }
  });

  // POST /api/wallet/evolve-nft
  app.post('/api/wallet/evolve-nft', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const ip = getClientIp(request, context.config.TRUST_PROXY);
      context.rateLimiter.limit(`wallet-evolve-nft:${ip}`, 20, 3600, context.now());

      const body = request.body as WalletEvolveBody | null;
      if (!body || typeof body !== 'object') {
        return reply.status(400).send({ error: 'Device credential not recognized' });
      }

      const pid = tokenPet(context, body.token);
      const tokenId = parseTokenId(body.tokenId);

      const nftContract = context.config.TINYFRENS_NFT_ADDRESS;
      if (!nftContract || !/^0x[a-fA-F0-9]{40}$/.test(nftContract)) {
        throw new Error('TinyFrens NFT contract is not configured.');
      }

      const data = encodeFunctionData({
        abi: parseAbi(['function evolve(uint256 tokenId)']),
        functionName: 'evolve',
        args: [BigInt(tokenId)],
      });

      const tx = await sendVaultTx(context, pid, nftContract, data);

      return reply.status(200).send({
        ok: true,
        tokenId,
        tx,
        ...chainNamePayload(context.config.CHAIN_ID),
      });
    } catch (err: any) {
      return reply.status(400).send({ error: err?.message || 'Could not evolve TinyFren' });
    }
  });

  // POST /api/wallet/unwrap-nft
  app.post('/api/wallet/unwrap-nft', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const ip = getClientIp(request, context.config.TRUST_PROXY);
      context.rateLimiter.limit(`wallet-unwrap-nft:${ip}`, 20, 3600, context.now());

      const body = request.body as WalletUnwrapBody | null;
      if (!body || typeof body !== 'object') {
        return reply.status(400).send({ error: 'Device credential not recognized' });
      }

      const pid = tokenPet(context, body.token);
      const tokenId = parseTokenId(body.tokenId);

      const row = context.repos.wallets.getFrenNft(pid, tokenId);
      if (!row) {
        throw new Error('TinyFren NFT not found in your vault.');
      }

      const lockedFrens = row.locked_frens || '0';
      const traitsData = row.traits ? JSON.parse(row.traits) : {};

      if (lockedFrens === '0' && !traitsData.vaultBacked) {
        throw new Error('This TinyFren is not backed by a FRENS Piggybank vault.');
      }

      const lockedAmount =
        lockedFrens !== '0'
          ? BigInt(lockedFrens)
          : BigInt(traitsData.lockedFrens || '47619047000000000000000000');

      let tx: any = null;
      const nftContract = context.config.TINYFRENS_NFT_ADDRESS;
      if (nftContract && /^0x[a-fA-F0-9]{40}$/.test(nftContract)) {
        try {
          const data = encodeFunctionData({
            abi: parseAbi(['function unwrap(uint256 tokenId)']),
            functionName: 'unwrap',
            args: [BigInt(tokenId)],
          });
          tx = await sendVaultTx(context, pid, nftContract, data);
        } catch (ex) {
          if (!context.config.ALLOW_TESTNET_FREE_MINT) {
            throw ex;
          }
        }
      }

      context.repos.wallets.deleteFrenNft(pid, tokenId);

      const currentPet = context.repos.pets.findById(pid);
      if (!currentPet) {
        throw new Error('Pet not found');
      }
      const currentProfile = JSON.parse(currentPet.profile);

      let updated = currentProfile;
      if (Number(currentProfile.tokenId) === tokenId) {
        updated = { ...currentProfile, tokenId: null };
        context.repos.pets.updateProfile(pid, JSON.stringify(updated));
      }

      context.repos.wallets.recordBurnLog(
        pid,
        tokenId,
        'unwrap',
        '0',
        lockedAmount.toString(),
        Math.floor(context.now())
      );

      const redeemedHuman = Number(lockedAmount) / 1e18;
      const formattedRedeemed = redeemedHuman.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });

      return reply.status(200).send({
        ok: true,
        tokenId,
        frensRedeemed: lockedAmount.toString(),
        frensRedeemedHuman: redeemedHuman,
        tx,
        pet: updated,
        message: `Unwrapped TinyFren #${tokenId}! Returned ${formattedRedeemed} FRENS to your wallet.`,
        ...chainNamePayload(context.config.CHAIN_ID),
      });
    } catch (err: any) {
      return reply.status(400).send({ error: err?.message || 'Could not unwrap TinyFren' });
    }
  });

  // POST /api/wallet/save-nft-changes
  app.post('/api/wallet/save-nft-changes', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const ip = getClientIp(request, context.config.TRUST_PROXY);
      context.rateLimiter.limit(`wallet-save-nft:${ip}`, 20, 3600, context.now());

      const body = request.body as WalletSaveNftChangesBody | null;
      if (!body || typeof body !== 'object') {
        return reply.status(400).send({ error: 'Device credential not recognized' });
      }

      const pid = tokenPet(context, body.token);
      const tokenId = parseTokenId(body.tokenId);

      const row = context.repos.wallets.getFrenNft(pid, tokenId);
      if (!row) {
        throw new Error('TinyFren NFT not found in your vault.');
      }

      const oldName = row.name;
      const traitsData = row.traits ? JSON.parse(row.traits) : nftTraitsById(tokenId);

      const customTraits = (body.customTraits || body.traits) as Record<string, any> | undefined;
      if (customTraits && typeof customTraits === 'object') {
        const cColor = String(customTraits.color || '');
        if (/^#[0-9a-fA-F]{6}$/.test(cColor)) {
          traitsData.color = cColor.toLowerCase();
        }

        const cExpr = String(customTraits.expression || '').toLowerCase();
        if (VALID_CUSTOM_EXPRESSIONS.has(cExpr)) {
          traitsData.expression = cExpr;
          traitsData.expressionLabel = cExpr
            .replace(/_/g, ' ')
            .replace(/\b\w/g, c => c.toUpperCase());
        }

        const cAcc = String(customTraits.accessory || '').toLowerCase();
        if (VALID_CUSTOM_ACCESSORIES.has(cAcc)) {
          traitsData.accessory = cAcc;
          traitsData.accessoryLabel = cAcc
            .replace(/_/g, ' ')
            .replace(/\b\w/g, c => c.toUpperCase());
        }
      }

      const newName = String(body.name || oldName).trim();
      const nftName =
        newName && newName.length >= 1 && newName.length <= 32
          ? newName.includes('#')
            ? newName
            : `TinyFren #${tokenId} · ${newName}`
          : oldName;

      const quote = calculateEthMintQuote(context);
      const totalFee = BigInt(String(quote.saveChangesFeeFrens || '5000000000000000000000'));
      const burnAmount = totalFee / 2n;
      const treasuryAmount = totalFee - burnAmount;

      if (context.economy) {
        const creditsNeeded = Number(
          creditsFromWei(totalFee, BigInt(context.economy.creditsPerFrens))
        );
        if (creditsNeeded > 0 && context.economy.balance(pid) >= creditsNeeded) {
          context.economy.spend(pid, creditsNeeded, 'save_nft_changes', 'nft', String(tokenId));
        }
      }

      const nowSec = Math.floor(context.now());
      context.repos.wallets.recordBurnLog(
        pid,
        tokenId,
        'save_changes',
        burnAmount.toString(),
        treasuryAmount.toString(),
        nowSec
      );

      context.repos.wallets.updateFrenNft(pid, tokenId, nftName, JSON.stringify(traitsData));

      const currentPet = context.repos.pets.findById(pid);
      if (!currentPet) {
        throw new Error('Pet not found');
      }
      const currentProfile = JSON.parse(currentPet.profile);

      let transformed = currentProfile;
      if (Number(currentProfile.tokenId) === tokenId) {
        const petName =
          newName && !newName.startsWith('TinyFren #')
            ? newName.slice(0, 20)
            : currentProfile.name;

        transformed = {
          ...currentProfile,
          ...traitsData,
          name: petName,
          tokenId,
        };

        context.repos.pets.updateProfile(pid, JSON.stringify(transformed));
      }

      const feeFrens = Number(totalFee) / 1e18;
      const burnedFrens = Number(burnAmount) / 1e18;
      const treasuryFrens = Number(treasuryAmount) / 1e18;

      const formattedBurned = burnedFrens.toLocaleString('en-US', { maximumFractionDigits: 0 });
      const formattedTreasury = treasuryFrens.toLocaleString('en-US', { maximumFractionDigits: 0 });

      return reply.status(200).send({
        ok: true,
        tokenId,
        name: nftName,
        traits: traitsData,
        feeFrens,
        burnedFrens,
        treasuryFrens,
        pet: transformed,
        message: `Saved changes to TinyFren #${tokenId}! Paid fee in FRENS: ${formattedBurned} burned (50%), ${formattedTreasury} sent to Treasury (50%).`,
      });
    } catch (err: any) {
      return reply.status(400).send({ error: err?.message || 'Could not save NFT changes' });
    }
  });

  // POST /api/wallet/magic-link
  app.post('/api/wallet/magic-link', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const ip = getClientIp(request, context.config.TRUST_PROXY);
      context.rateLimiter.limit(`wallet-magic:${ip}`, 15, 3600, context.now());

      const body = request.body as WalletMagicLinkBody | null;
      if (!body || typeof body !== 'object') {
        return reply.status(400).send({ error: 'Device credential not recognized' });
      }

      const pid = tokenPet(context, body.token);
      const code = crypto.randomBytes(16).toString('base64url');
      const nowSec = Math.floor(context.now());
      const expires = nowSec + 15 * 60;

      context.repos.wallets.createMagicLink(code, pid, nowSec, expires);
      const restoreUrl = `https://tinyfrens.lol/web/#restore=${code}`;

      return reply.status(200).send({ code, restoreUrl, expires });
    } catch (err: any) {
      return reply.status(400).send({ error: err?.message || 'Could not generate magic link' });
    }
  });

  // POST /api/wallet/restore
  app.post('/api/wallet/restore', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const ip = getClientIp(request, context.config.TRUST_PROXY);
      context.rateLimiter.limit(`wallet-restore:${ip}`, 30, 3600, context.now());

      const body = request.body as WalletRestoreBody | null;
      if (!body || typeof body !== 'object') {
        throw new Error('Bad request');
      }

      const code = String(body.code || '').trim();
      const row = context.repos.wallets.getMagicLink(code);

      if (!row || row.expires <= Math.floor(context.now())) {
        return reply.status(404).send({ error: 'Magic restore link is invalid or expired.' });
      }

      const pid = row.pet_id;
      const petRow = context.repos.pets.findById(pid);
      if (!petRow) {
        return reply.status(404).send({ error: 'Pet not found' });
      }

      const newToken = crypto.randomBytes(32).toString('base64url');
      const tokenHash = crypto.createHash('sha256').update(newToken).digest('hex');

      context.db.transaction(() => {
        context.db.prepare('UPDATE pets SET token=? WHERE id=?').run(tokenHash, pid);
        context.repos.wallets.deleteMagicLink(code);
      })();

      const { address: evmAddr } = frenVaultAddressAndKey(pid, context.config.FREN_VAULT_SEED);

      return reply.status(200).send({
        success: true,
        id: pid,
        code: petRow.code,
        token: newToken,
        pet: JSON.parse(petRow.profile),
        evmAddress: evmAddr,
        vaultAddress: evmAddr,
      });
    } catch (err: any) {
      return reply.status(400).send({ error: err?.message || 'Could not restore fren' });
    }
  });
}
