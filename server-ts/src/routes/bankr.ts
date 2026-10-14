import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AppContext } from '../context.js';
import { getClientIp } from '../rate-limit.js';
import { tokenPet } from '../domain/account.js';
import { normalizeProfile } from '../domain/profile.js';
import { nftTraits, nftTraitsById } from '../domain/nft-traits.js';
import { frenVaultAddressAndKey } from '../crypto/vault.js';

interface BankrWalletBody {
  token?: string;
  pet?: unknown;
}

interface BankrNftsBody {
  token?: string;
}

interface BankrTransformBody {
  token?: string;
  nft?: unknown;
}

interface BankrMonitorBody {
  token?: string;
  pet?: unknown;
  wallet?: string;
  question?: string;
}

export function registerBankrRoutes(app: FastifyInstance, context: AppContext): void {
  // GET /api/bankr/status
  app.get('/api/bankr/status', async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.status(200).send({
      connected: Boolean(context.config.BANKR_API_KEY),
      partner: Boolean(context.config.BANKR_PARTNER_KEY),
    });
  });

  // POST /api/bankr/wallet
  app.post('/api/bankr/wallet', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const ip = getClientIp(request, context.config.TRUST_PROXY);
      context.rateLimiter.limit(`bankr-wallet:${ip}`, 20, 3600, context.now());

      const body = request.body as BankrWalletBody | null;
      if (!body || typeof body !== 'object') {
        return reply.status(400).send({ error: 'Device credential not recognized' });
      }

      const pid = tokenPet(context, body.token);

      if (body.pet !== undefined && body.pet !== null) {
        const p = normalizeProfile(body.pet);
        context.repos.pets.updateProfile(pid, JSON.stringify(p));
      }

      const row = context.repos.wallets.getPetWallet(pid);
      if (row && (row.provider === 'bankr-partner' || row.provider === 'fren-vault') && row.evm_address) {
        return reply.status(200).send({
          mode: row.provider,
          walletId: row.wallet_id,
          evmAddress: row.evm_address,
          solAddress: row.sol_address || '',
          partner: row.provider === 'bankr-partner',
          message: 'Your personal Fren Pocket Vault on Base.',
        });
      }

      const partnerKey = context.config.BANKR_PARTNER_KEY;
      if (partnerKey) {
        const bankrBase = context.config.BANKR_API_URL.replace(/\/$/, '');
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 20000);

        try {
          const payload = {
            idempotencyKey: 'tinyfrens:' + pid,
            wallet: { solana: false },
            apiKey: {
              permissions: {
                agentApiEnabled: true,
                llmGatewayEnabled: false,
                tokenLaunchApiEnabled: false,
                readOnly: false,
              },
            },
          };

          const res = await fetch(bankrBase + '/partner/wallets', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Partner-Key': partnerKey,
            },
            body: JSON.stringify(payload),
            signal: controller.signal,
          });

          const data = (await res.json()) as any;
          if (res.status < 400 && data?.evmAddress) {
            context.repos.wallets.upsertPetWallet({
              pet_id: pid,
              provider: 'bankr-partner',
              wallet_id: data.id || '',
              evm_address: data.evmAddress,
              sol_address: data.solAddress || '',
              api_key: data.apiKey || '',
              nft: null,
              created: Math.floor(context.now()),
            });

            return reply.status(200).send({
              mode: 'bankr-partner',
              walletId: data.id || '',
              evmAddress: data.evmAddress,
              solAddress: data.solAddress || '',
              partner: true,
              message: 'Your dedicated Bankr partner wallet.',
            });
          }
        } catch {
          // Fall through to fren-vault fallback
        } finally {
          clearTimeout(timeout);
        }
      }

      const { address: evmAddr, privateKey: evmKey } = frenVaultAddressAndKey(
        pid,
        context.config.FREN_VAULT_SEED
      );
      context.repos.wallets.upsertPetWallet({
        pet_id: pid,
        provider: 'fren-vault',
        wallet_id: 'vault:' + pid,
        evm_address: evmAddr,
        sol_address: '',
        api_key: evmKey,
        nft: null,
        created: Math.floor(context.now()),
      });

      return reply.status(200).send({
        mode: 'fren-vault',
        walletId: 'vault:' + pid,
        evmAddress: evmAddr,
        solAddress: '',
        partner: false,
        message: 'Your personal Fren Pocket Vault on Base.',
      });
    } catch (err: any) {
      return reply.status(400).send({ error: err?.message || 'Fren vault is having trouble right now' });
    }
  });

  // POST /api/bankr/nfts
  app.post('/api/bankr/nfts', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const ip = getClientIp(request, context.config.TRUST_PROXY);
      context.rateLimiter.limit(`bankr-nfts:${ip}`, 60, 3600, context.now());

      const body = request.body as BankrNftsBody | null;
      if (!body || typeof body !== 'object') {
        return reply.status(400).send({ error: 'Device credential not recognized' });
      }

      const pid = tokenPet(context, body.token);
      const row = context.repos.wallets.getPetWallet(pid);
      const evmAddr = row?.evm_address || frenVaultAddressAndKey(pid, context.config.FREN_VAULT_SEED).address;

      const nfts: any[] = [];
      const dbNfts = context.repos.wallets.listFrenNfts(pid);

      for (const rowNft of dbNfts) {
        let traitsData: any;
        if (rowNft.traits) {
          try {
            traitsData = JSON.parse(rowNft.traits);
          } catch {
            traitsData = nftTraitsById(rowNft.token_id);
          }
        } else {
          traitsData = nftTraitsById(rowNft.token_id);
        }

        const lockedVal = rowNft.locked_frens;
        const isVault = Boolean((lockedVal && lockedVal !== '0') || traitsData?.vaultBacked);
        const lockedStr = (lockedVal && lockedVal !== '0') ? lockedVal : String(traitsData?.lockedFrens || '0');

        nfts.push({
          chain: 'base',
          collection: {
            name: 'TinyFrens',
            address: context.config.TINYFRENS_NFT_ADDRESS || '0xTinyFrensNFT',
          },
          tokenId: rowNft.token_id,
          name: rowNft.name || `TinyFren #${rowNft.token_id}`,
          traits: traitsData,
          vaultBacked: isVault,
          lockedFrens: lockedStr,
        });
      }

      if (row && row.provider === 'bankr-partner' && row.api_key) {
        const bankrBase = context.config.BANKR_API_URL.replace(/\/$/, '');
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);

        try {
          const res = await fetch(bankrBase + '/wallet/portfolio?include=nfts', {
            headers: { 'X-API-Key': row.api_key },
            signal: controller.signal,
          });

          if (res.status < 400) {
            const data = (await res.json()) as any;
            if (Array.isArray(data?.nfts)) {
              nfts.push(...data.nfts);
            }
          }
        } catch {
          // Ignore external portfolio error
        } finally {
          clearTimeout(timeout);
        }
      }

      return reply.status(200).send({ nfts, evmAddress: evmAddr });
    } catch (err: any) {
      return reply.status(400).send({ error: err?.message || 'Could not read fren NFTs' });
    }
  });

  // POST /api/bankr/transform
  app.post('/api/bankr/transform', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const ip = getClientIp(request, context.config.TRUST_PROXY);
      context.rateLimiter.limit(`bankr-transform:${ip}`, 30, 3600, context.now());

      const body = request.body as BankrTransformBody | null;
      if (!body || typeof body !== 'object') {
        return reply.status(400).send({ error: 'Device credential not recognized' });
      }

      const pid = tokenPet(context, body.token);
      const nft = body.nft as Record<string, any> | null;
      if (!nft || typeof nft !== 'object' || Array.isArray(nft)) {
        throw new Error('Choose an NFT first');
      }

      const rawName = String(nft.name || 'NFT Fren')
        .replace(/[\x00-\x1f\x7f]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      const name = rawName.slice(0, 20) || 'NFT Fren';

      const currentPet = context.repos.pets.findById(pid);
      if (!currentPet) {
        throw new Error('Pet not found');
      }

      const currentProfile = JSON.parse(currentPet.profile);
      const traits = nftTraits(nft);
      const transformed: Record<string, any> = { ...currentProfile, ...traits, name };

      if (nft.tokenId !== undefined && nft.tokenId !== null) {
        const parsed = parseInt(String(nft.tokenId).split('.')[0], 10);
        if (!isNaN(parsed)) {
          transformed.tokenId = parsed;
        }
      }

      context.repos.pets.updateProfile(pid, JSON.stringify(transformed));

      if (context.repos.wallets.getPetWallet(pid)) {
        context.repos.wallets.updatePetWalletNft(pid, JSON.stringify(nft));
      } else {
        context.repos.wallets.upsertPetWallet({
          pet_id: pid,
          provider: 'server-agent',
          wallet_id: '',
          evm_address: '',
          sol_address: '',
          api_key: context.config.BANKR_API_KEY || '',
          nft: JSON.stringify(nft),
          created: Math.floor(context.now()),
        });
      }

      return reply.status(200).send({ pet: transformed, nft });
    } catch (err: any) {
      return reply.status(400).send({ error: err?.message || 'Could not transform your fren' });
    }
  });

  // POST /api/bankr/monitor
  app.post('/api/bankr/monitor', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const ip = getClientIp(request, context.config.TRUST_PROXY);
      context.rateLimiter.limit(`bankr:${ip}`, 12, 3600, context.now());

      const apiKey = context.config.BANKR_API_KEY;
      if (!apiKey) {
        return reply.status(503).send({ error: 'Bankr is not connected yet' });
      }

      const body = request.body as BankrMonitorBody | null;
      if (!body || typeof body !== 'object') {
        throw new Error('Bad request');
      }

      const p = normalizeProfile(body.pet);
      const wallet = String(body.wallet || '').replace(/\s+/g, '').trim();
      let question = String(body.question || '')
        .replace(/[\x00-\x1f\x7f]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 300);

      if (wallet.length < 4 || wallet.length > 120 || !/^[A-Za-z0-9:._-]+$/.test(wallet)) {
        throw new Error('Enter a wallet address first');
      }

      if (!question) {
        question = 'Give me a quick read on this wallet today.';
      }

      const prompt =
        'You are Bankr being used inside TinyFrens, a tiny pet app. This is read-only wallet monitoring. ' +
        'Do not trade, swap, transfer, sign, deploy, or ask for private keys. Do not give financial advice. ' +
        `Pet name: ${p.name}. Public wallet/address to monitor: ${wallet}. ` +
        `User request: ${question}. ` +
        'Answer in a compact TinyFrens style: first say whether the day looks green, red, or quiet if data supports it, ' +
        'then mention the most important wallet signal at a glance. Keep it under 90 words.';

      const bankrBase = context.config.BANKR_API_URL.replace(/\/$/, '');
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 35000);

      try {
        const promptRes = await fetch(bankrBase + '/agent/prompt', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': apiKey,
          },
          body: JSON.stringify({ prompt }),
          signal: controller.signal,
        });

        const promptData = (await promptRes.json()) as any;
        if (promptRes.status >= 400) {
          return reply.status(promptRes.status).send({
            error: promptData?.message || promptData?.error || 'Bankr is unavailable',
          });
        }

        const jobId = promptData?.jobId;
        const threadId = promptData?.threadId;

        if (!jobId) {
          return reply.status(400).send({ error: 'Bankr did not return a job id' });
        }

        let result = promptData;
        for (let i = 0; i < 14; i++) {
          await new Promise(resolve => setTimeout(resolve, 2000));
          const pollRes = await fetch(bankrBase + `/agent/job/${jobId}`, {
            headers: { 'X-API-Key': apiKey },
            signal: controller.signal,
          });

          result = (await pollRes.json()) as any;
          if (pollRes.status >= 400) {
            return reply.status(pollRes.status).send({
              error: result?.message || result?.error || 'Bankr is unavailable',
            });
          }

          if (['completed', 'failed', 'cancelled'].includes(result?.status)) {
            break;
          }
        }

        if (result?.status !== 'completed') {
          return reply.status(200).send({
            pending: true,
            jobId,
            threadId,
            reply: 'Bankr is still thinking. Try again in a moment.',
          });
        }

        let answer = String(result?.response || result?.message || '').trim();
        const rich = result?.richData;
        if (!answer && rich && typeof rich === 'object') {
          answer = String(rich.summary || rich.text || '').trim();
        }

        answer = answer.replace(/[*_`#>\[\]]/g, '').slice(0, 900);
        if (!answer) {
          answer = 'Bankr finished, but did not return a readable wallet note.';
        }

        return reply.status(200).send({
          reply: answer,
          wallet,
          jobId,
          threadId,
        });
      } finally {
        clearTimeout(timeout);
      }
    } catch (err: any) {
      return reply.status(400).send({ error: err?.message || 'Bankr is having trouble right now' });
    }
  });
}
