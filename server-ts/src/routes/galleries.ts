import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AppContext } from '../context.js';
import { turtleId } from '../domain/turtle-ownership.js';
import { getClientIp } from '../rate-limit.js';

export const SUPPORTED_GALLERY_COLLECTIONS = [
  {
    id: 'robots',
    name: 'Robots v1',
    contract: '0xd745d8005a1ad8f783b97bf55e0d0e6a920ea8ff',
    chainId: 8453,
    release: true,
    explorer: 'https://basescan.org',
  },
  {
    id: 'hood-turtles',
    name: 'Hood Turtles',
    contract: '0xca28587b61eac19a87dfcfd9420870867a916675',
    chainId: 4663,
    release: false,
    explorer: null,
  },
  {
    id: 'nubs',
    name: 'Nubs',
    contract: '0x34d9e560ee16662d19e44315a822bd51eea0133c',
    chainId: 4663,
    release: false,
    explorer: null,
  },
  {
    id: 'bots-computers',
    name: 'Bots Computers',
    contract: '0x8d446c126d4873bfa3eb195b7f0094acc1187a75',
    chainId: 8453,
    release: false,
    explorer: 'https://basescan.org',
  },
];

interface ImportedItem {
  tokenId: number;
  metadata: { name?: string; image?: string };
  owner: string;
  checkedAt?: number;
}

export function registerGalleryRoutes(app: FastifyInstance, context: AppContext): void {
  // Collections list
  app.get('/api/gallery/collections', async (_request: FastifyRequest, reply: FastifyReply) => {
    reply.header('Cache-Control', 'public, max-age=60');
    return reply.status(200).send({ collections: SUPPORTED_GALLERY_COLLECTIONS });
  });

  // Imported gallery page
  app.get('/api/gallery/imported', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as Record<string, string | undefined>;
    const collectionId = query.collection;

    const collection = SUPPORTED_GALLERY_COLLECTIONS.find(
      c => c.id === collectionId && !c.release
    );
    if (!collection) {
      return reply.status(400).send({ error: 'Unsupported imported collection' });
    }

    const rawAfter = query.after ?? '0';
    const after = parseInt(rawAfter, 10);
    if (isNaN(after) || after < 0 || after > 10000) {
      return reply.status(400).send({ error: 'Invalid gallery cursor' });
    }

    // Query active verified selection items from DB
    const itemsMap: Record<number, ImportedItem> = {};
    const rows = context.db.prepare<{ account: string; selection: string; address: string }>(
      `SELECT DISTINCT a.account, a.selection, w.address
       FROM device_sync_accounts a
       JOIN device_sync_members m ON m.account = a.account
       JOIN wallet_links w ON w.pet_id = m.device`
    ).all();

    for (const row of rows) {
      let selectedNfts: Array<{ chainId?: number; originalAddress?: string; tokenId?: number }> = [];
      try {
        selectedNfts = JSON.parse(row.selection);
      } catch {
        continue;
      }

      for (const nft of selectedNfts) {
        if (
          nft.chainId !== collection.chainId ||
          (nft.originalAddress || '').toLowerCase() !== collection.contract.toLowerCase()
        ) {
          continue;
        }

        const tid = nft.tokenId;
        if (typeof tid !== 'number' || tid <= after || itemsMap[tid]) {
          continue;
        }

        let payloadJson: string | undefined;
        if (collection.contract.toLowerCase() === '0xca28587b61eac19a87dfcfd9420870867a916675') {
          payloadJson = context.repos.robots.getTurtleOwnership(row.address, tid)?.payload ?? undefined;
        } else {
          payloadJson = context.repos.robots.getExtraCompanionOwnership(
            row.address,
            collection.contract,
            tid
          )?.payload ?? undefined;
        }

        if (!payloadJson) continue;

        try {
          const data = JSON.parse(payloadJson);
          if (
            !data.active ||
            data.chainId !== collection.chainId ||
            (data.originalAddress || '').toLowerCase() !== collection.contract.toLowerCase() ||
            data.tokenId !== tid ||
            String(data.originalOwner || '').toLowerCase() !== row.address.toLowerCase() ||
            !data.image
          ) {
            continue;
          }

          itemsMap[tid] = {
            tokenId: tid,
            metadata: { name: data.name, image: data.image },
            owner: data.originalOwner,
            checkedAt: data.checkedAt,
          };
        } catch {
          continue;
        }
      }
    }

    const sortedIds = Object.keys(itemsMap)
      .map(Number)
      .sort((a, b) => a - b);
    const selected = sortedIds.slice(0, 24);

    reply.header('Cache-Control', 'no-store');
    return reply.status(200).send({
      contract: collection.contract,
      chainId: collection.chainId,
      items: selected.map(tid => itemsMap[tid]),
      nextAfter: sortedIds.length > 24 ? selected[selected.length - 1] : null,
    });
  });

  // Robots Gallery endpoint
  app.get('/api/robots/gallery', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as Record<string, string | undefined>;
    const rawAfter = query.after ?? '0';
    const after = parseInt(rawAfter, 10);
    if (isNaN(after) || after < 0 || after > 2664) {
      return reply.status(400).send({ error: 'Invalid gallery cursor' });
    }

    const force = query.refresh === '1';

    // Get cached gallery art and owners
    const items: Array<{
      tokenId: number;
      metadata: Record<string, unknown>;
      owner: string | null;
      xHandle: string | null;
    }> = [];

    // Query tokens greater than cursor
    const artRows = context.db.prepare<{ token: number; metadata: string }>(
      'SELECT token, metadata FROM robot_gallery_art WHERE token > ? ORDER BY token ASC LIMIT 24'
    ).all(after);

    for (const artRow of artRows) {
      let metadata: Record<string, unknown> = {};
      try {
        metadata = JSON.parse(artRow.metadata);
      } catch {
        // Skip malformed
      }

      const owner = context.repos.robots.getGalleryOwner(artRow.token) ?? null;
      const xHandle = owner ? context.repos.wallets.getSocialProfile(owner)?.x_handle ?? null : null;

      items.push({
        tokenId: artRow.token,
        metadata,
        owner,
        xHandle,
      });
    }

    const totalCountRow = context.db.prepare<{ count: number }>(
      'SELECT COUNT(*) as count FROM robot_gallery_art'
    ).get();
    const supply = totalCountRow?.count ?? 0;
    const last = items.length > 0 ? items[items.length - 1].tokenId : after;

    const hasMoreRow = context.db.prepare<{ token: number }>(
      'SELECT token FROM robot_gallery_art WHERE token > ? LIMIT 1'
    ).get(last);

    const data = {
      contract: '0xd745d8005a1ad8f783b97bf55e0d0e6a920ea8ff',
      chainId: 8453,
      supply,
      items,
      nextAfter: hasMoreRow ? last : null,
      checkedAt: Math.floor(context.now()),
      stale: false,
    };

    if (!force) {
      reply.header('Cache-Control', 'public, max-age=30');
    } else {
      reply.header('Cache-Control', 'no-store');
    }

    return reply.status(200).send(data);
  });

  // Hood Turtle Preview endpoint
  const turtlePreviews = new Map<number, [number, any]>();

  app.get('/api/hood-turtles/preview', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const ip = getClientIp(request, context.config.TRUST_PROXY);
      context.rateLimiter.limit(`turtle-preview:${ip}`, 30, 60, context.now());

      const query = request.query as Record<string, string | undefined>;
      const tid = turtleId(query.tokenId ?? '1');

      const cached = turtlePreviews.get(tid);
      const now = context.now();
      if (cached && cached[0] > now) {
        return reply.status(200).send(cached[1]);
      }

      const original = await context.turtleOwnership.read(null, tid);
      const data = {
        tokenId: original.tokenId,
        name: original.name,
        image: original.image,
        originalAddress: original.originalAddress,
        chainId: original.chainId,
      };

      if (turtlePreviews.size >= 64) {
        const firstKey = turtlePreviews.keys().next().value;
        if (firstKey !== undefined) turtlePreviews.delete(firstKey);
      }
      turtlePreviews.set(tid, [now + 300, data]);

      return reply.status(200).send(data);
    } catch (err: any) {
      if (err?.message?.includes('Enter a Hood Turtle token number')) {
        return reply.status(400).send({ error: err.message });
      }
      return reply.status(503).send({ error: 'Collection preview unavailable' });
    }
  });
}
