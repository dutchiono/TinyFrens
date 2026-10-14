import fs from 'node:fs';
import path from 'node:path';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AppContext } from '../context.js';

function getFarcasterManifest(): Record<string, unknown> {
  const candidates = [
    path.resolve(process.cwd(), 'web/.well-known/farcaster.json'),
    path.resolve(process.cwd(), '../web/.well-known/farcaster.json'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      try {
        return JSON.parse(fs.readFileSync(p, 'utf-8'));
      } catch {
        // Fall back
      }
    }
  }
  return {
    accountAssociation: { header: '', payload: '', signature: '' },
    frame: {
      version: '1',
      name: 'TinyFrens',
      iconUrl: 'https://tinyfrens.lol/icons/icon-192.png',
      homeUrl: 'https://tinyfrens.lol/',
      imageUrl: 'https://tinyfrens.lol/icons/og-card.png',
      buttonTitle: 'Play TinyFrens',
      splashImageUrl: 'https://tinyfrens.lol/icons/icon-192.png',
      splashBackgroundColor: '#17142a',
    },
  };
}

export function registerFarcasterRoutes(app: FastifyInstance, _context: AppContext): void {
  // Farcaster manifest
  app.get('/.well-known/farcaster.json', async (_request: FastifyRequest, reply: FastifyReply) => {
    reply.header('Content-Type', 'application/json');
    return reply.status(200).send(getFarcasterManifest());
  });

  // Snap Frame handler for /, /snap, /api/snap
  const handleSnap = async (request: FastifyRequest, reply: FastifyReply) => {
    const accept = request.headers.accept || '';
    const query = request.query as Record<string, string | undefined>;
    const nftParam = query.nft || query.id;
    const nameParam = query.name;
    const speciesParam = query.species;

    let nftId: number | null = null;
    if (nftParam) {
      const parsed = parseInt(nftParam, 10);
      if (!isNaN(parsed) && parsed >= 1 && parsed <= 18432) {
        nftId = parsed;
      }
    }

    const linkQuery = nftId
      ? `?nft=${nftId}`
      : nameParam
        ? `?name=${encodeURIComponent(nameParam)}&species=${encodeURIComponent(speciesParam || '')}`
        : '';
    const linkHdr = `<https://www.tinyfrens.lol/snap${linkQuery}>; rel="alternate"; type="application/vnd.farcaster.snap+json"`;

    reply.header('Vary', 'Accept');
    reply.header('Link', linkHdr);

    if (!accept.includes('application/vnd.farcaster.snap+json') && accept.includes('text/html')) {
      const cardTitle = nameParam
        ? `${nameParam} • ${speciesParam || 'TinyFren'}`
        : nftId
          ? `TinyFren #${nftId}`
          : 'TinyFrens Snap';
      const cardDesc = nftId
        ? `Verified On-Chain #${nftId} Companion`
        : nameParam
          ? 'Interactive Pocket Pet on Farcaster'
          : 'An interactive pet built for Farcaster casts.';

      const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${cardTitle} • Farcaster Snap</title><meta property="og:title" content="${cardTitle} • In-Feed Pocket Pet"><meta property="og:description" content="${cardDesc}"><meta property="og:image" content="https://tinyfrens.lol/icons/og-card.png"><link rel="alternate" type="application/vnd.farcaster.snap+json" href="https://www.tinyfrens.lol/snap${linkQuery}"><link rel="icon" href="https://tinyfrens.lol/icons/icon.svg"></head><body><div class="card"><h1>${cardTitle}</h1><p>${cardDesc}</p></div></body></html>`;

      reply.header('Content-Type', 'text/html; charset=utf-8');
      return reply.status(200).send(html);
    }

    const payload = {
      version: '2.0',
      theme: { accent: 'purple' },
      effects: [],
      ui: {
        root: 'page',
        elements: {
          page: {
            type: 'box',
            props: { padding: 16 },
            children: ['header'],
          },
          header: {
            type: 'text',
            props: {
              text: nameParam ? `${nameParam}` : nftId ? `TinyFren #${nftId}` : 'TinyFren',
            },
          },
        },
      },
    };

    reply.header('Content-Type', 'application/vnd.farcaster.snap+json');
    return reply.status(200).send(payload);
  };

  app.get('/', handleSnap);
  app.get('/snap', handleSnap);
  app.get('/api/snap', handleSnap);

  app.post('/api/farcaster/webhook', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const data = request.body;
      if (data && typeof data === 'object') {
        return reply.status(200).send({ received: true });
      }
      return reply.status(200).send({ ok: true });
    } catch {
      return reply.status(200).send({ ok: true });
    }
  });

  app.post('/api/farcaster/notify', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const apiKey = _context.config.NEYNAR_API_KEY;
      if (!apiKey) {
        return reply.status(503).send({ error: 'Neynar API key is not configured' });
      }
      const body = (request.body || {}) as Record<string, unknown>;
      const title = String(body.title || 'TinyFrens').trim().slice(0, 60);
      const msgBody = String(body.body || 'Your fren wants to play!').trim().slice(0, 160);
      const targetUrl = String(body.targetUrl || 'https://tinyfrens.lol/').trim();

      const neynarUrl = (_context.config as Record<string, unknown>).NEYNAR_URL as string || 'https://api.neynar.com';
      const response = await fetch(`${neynarUrl}/v2/farcaster/frame/notifications`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
        },
        body: JSON.stringify({
          notification: {
            title,
            body: msgBody,
            target_url: targetUrl,
          },
        }),
      });

      const data = (await response.json()) as Record<string, unknown>;
      if (response.status >= 400) {
        return reply.status(response.status).send({ error: data.message || 'Could not send notification' });
      }
      return reply.status(response.status).send(data);
    } catch (e) {
      return reply.status(400).send({ error: (e as Error).message });
    }
  });

  app.post('/api/farcaster/cast', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const apiKey = _context.config.NEYNAR_API_KEY;
      const signerUuid = _context.config.FARCASTER_SIGNER_UUID;
      if (!apiKey) {
        return reply.status(503).send({ error: 'Neynar API key is not configured' });
      }
      if (!signerUuid) {
        return reply.status(503).send({ error: 'FARCASTER_SIGNER_UUID is not configured yet' });
      }

      const body = (request.body || {}) as Record<string, unknown>;
      const text = String(body.text || '').trim().slice(0, 1024);
      if (!text) {
        return reply.status(400).send({ error: 'Cast text cannot be empty' });
      }

      const payload: Record<string, unknown> = {
        signer_uuid: signerUuid,
        text,
      };
      if (Array.isArray(body.embeds) && body.embeds.length > 0) {
        payload.embeds = body.embeds;
      }

      const neynarUrl = (_context.config as Record<string, unknown>).NEYNAR_URL as string || 'https://api.neynar.com';
      const response = await fetch(`${neynarUrl}/v2/farcaster/cast`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
        },
        body: JSON.stringify(payload),
      });

      const data = (await response.json()) as Record<string, unknown>;
      if (response.status >= 400) {
        return reply.status(response.status).send({ error: data.message || 'Could not publish cast' });
      }
      return reply.status(response.status).send(data);
    } catch (e) {
      return reply.status(400).send({ error: (e as Error).message });
    }
  });
}

