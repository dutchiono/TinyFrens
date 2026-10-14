import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AppContext } from '../context.js';

const TOKEN_URI_SELECTOR = '0xc87b56dd';

export function calculateEthMintQuote(context: AppContext): Record<string, unknown> {
  const priceWei = BigInt(context.config.TINYFRENS_NFT_MINT_PRICE_WEI);
  const priceEth = Number(priceWei) / 1e18;
  const vaultEth = 0.002;
  const vaultEthWei = (2_000_000_000_000_000n).toString();
  const vaultFrensAmount = BigInt(context.config.FRENS_PER_VAULT_MINT || '47619047000000000000000000');
  const saveFeeFrens = BigInt(context.config.SAVE_CHANGES_FEE_FRENS || '5000000000000000000000');
  const nowSec = Math.floor(context.now());

  return {
    priceEth,
    ethRequired: priceEth,
    ethRequiredWei: priceWei.toString(),
    vaultEth,
    vaultEthWei,
    vaultFrensRequired: vaultFrensAmount.toString(),
    vaultFrensHuman: Number(vaultFrensAmount) / 1e18,
    saveChangesFeeFrens: saveFeeFrens.toString(),
    saveChangesFeeHuman: Number(saveFeeFrens) / 1e18,
    burnPercent: 50,
    treasuryPercent: 50,
    symbol: 'ETH',
    frensSymbol: 'FRENS',
    chain: context.config.ECONOMY_MODE === 'testnet' ? 'base-sepolia' : 'base',
    timestamp: nowSec,
    expiresAt: nowSec + 60,
  };
}

export function registerNftRoutes(app: FastifyInstance, context: AppContext): void {
  app.get('/api/nft/price', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const quote = calculateEthMintQuote(context);
      return reply.status(200).send(quote);
    } catch (err: unknown) {
      return reply.status(500).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get('/api/nft/uri', async (request: FastifyRequest, reply: FastifyReply) => {
    const nft = context.config.TINYFRENS_NFT_ADDRESS;
    const rpc = context.config.BASE_RPC_URL;
    const addrRegex = /^0x[a-fA-F0-9]{40}$/;

    if (!nft || !rpc || !addrRegex.test(nft)) {
      return reply.status(503).send({ error: 'NFT contract / RPC not configured' });
    }

    const query = request.query as Record<string, string | undefined>;
    const rawTid = query.tokenId ?? '0';
    const tid = parseInt(rawTid, 10);

    if (isNaN(tid) || tid < 1 || tid > 1_000_000) {
      return reply.status(400).send({ error: 'tokenId out of range' });
    }

    try {
      // 32-byte hex encoded tokenId
      const tidHex = tid.toString(16).padStart(64, '0');
      const data = TOKEN_URI_SELECTOR + tidHex;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      const rpcResponse = await fetch(rpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'eth_call',
          params: [{ to: nft, data }, 'latest'],
        }),
        signal: controller.signal,
      }).finally(() => clearTimeout(timeout));

      const body = (await rpcResponse.json()) as { error?: unknown; result?: string };
      if (body.error || !body.result || body.result === '0x') {
        return reply.status(200).send({ tokenId: tid, minted: false, uri: null });
      }

      // ABI decode string
      const rawHex = body.result.startsWith('0x') ? body.result.slice(2) : body.result;
      const buffer = Buffer.from(rawHex, 'hex');
      const offset = Number(buffer.readBigUInt64BE(24));
      const length = Number(buffer.readBigUInt64BE(offset + 24));
      const uri = buffer.subarray(offset + 32, offset + 32 + length).toString('utf-8');

      return reply.status(200).send({
        tokenId: tid,
        minted: true,
        uri,
        collection: { name: 'TinyFrens', address: nft },
      });
    } catch {
      return reply.status(503).send({ error: 'NFT contract call failed. Please retry shortly.' });
    }
  });
}
