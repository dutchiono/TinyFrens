import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AppContext } from '../context.js';

export function registerCollectionRoutes(app: FastifyInstance, context: AppContext): void {
  // Collection suggestions listing
  app.get('/api/collections/suggestions', async (_request: FastifyRequest, reply: FastifyReply) => {
    const rows = context.repos.votes.listSuggestionsWithVotes();
    const creditsPerFrens = 100;

    const collections = rows.map(row => {
      const credits = row.total_credits;
      const frens =
        credits % creditsPerFrens
          ? Math.round((credits / creditsPerFrens) * 10000) / 10000
          : Math.floor(credits / creditsPerFrens);

      return {
        id: row.id,
        chainId: row.chain_id,
        address: row.address,
        name: row.name,
        created: row.created,
        credits,
        votes: row.total_voters,
        frens,
      };
    });

    return reply.status(200).send({ collections });
  });

  // Vote status endpoint
  app.get('/api/vote/status', async (_request: FastifyRequest, reply: FastifyReply) => {
    const treasury = (context.config.FRENS_TREASURY || '').trim();
    const token = (context.config.FRENS_TOKEN || '0x1A96226727a1D0a46334b3A4b3878B32B7659ba3').trim();
    const isTreasuryIndexer = Boolean(context.config.FRENS_TREASURY_INDEXER);

    reply.header('Cache-Control', 'no-store');
    return reply.status(200).send({
      balance: 0,
      creditsPerFrens: 100,
      deposit: {
        enabled: Boolean(isTreasuryIndexer && treasury),
        address: isTreasuryIndexer && treasury ? treasury : null,
        chainId: context.config.CHAIN_ID || 8453,
        token: token || '0x1A96226727a1D0a46334b3A4b3878B32B7659ba3',
      },
    });
  });
}
