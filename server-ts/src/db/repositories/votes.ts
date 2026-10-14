import { DatabaseConnection } from '../connection.js';

export interface CollectionSuggestionRow {
  id: number;
  chain_id: number;
  address: string;
  name: string;
  created: number;
}

export interface CollectionSuggestionWithVotes extends CollectionSuggestionRow {
  total_credits: number;
  total_voters: number;
}

export interface CollectionVoteRow {
  id: number;
  collection_id: number;
  pet_id: string;
  credits: number;
  frens_amount: string;
  created: number;
}

export class VoteRepository {
  constructor(private db: DatabaseConnection) {}

  getSuggestionById(id: number): CollectionSuggestionRow | undefined {
    return this.db.prepare<CollectionSuggestionRow>(
      'SELECT id, chain_id, address, name, created FROM collection_suggestions WHERE id=?'
    ).get(id);
  }

  getSuggestionByAddress(chainId: number, address: string): CollectionSuggestionRow | undefined {
    return this.db.prepare<CollectionSuggestionRow>(
      'SELECT id, chain_id, address, name, created FROM collection_suggestions WHERE chain_id=? AND address=? COLLATE NOCASE'
    ).get(chainId, address);
  }

  countSuggestions(): number {
    const row = this.db.prepare<{ count: number }>(
      'SELECT COUNT(*) as count FROM collection_suggestions'
    ).get();
    return row?.count ?? 0;
  }

  createSuggestion(chainId: number, address: string, name: string, created: number): number {
    const result = this.db.prepare(
      'INSERT INTO collection_suggestions(chain_id, address, name, created) VALUES(?, ?, ?, ?)'
    ).run(chainId, address, name, created);
    return Number(result.lastInsertRowid);
  }

  listSuggestionsWithVotes(): CollectionSuggestionWithVotes[] {
    return this.db.prepare<CollectionSuggestionWithVotes>(
      `SELECT s.id, s.chain_id, s.address, s.name, s.created,
              COALESCE(SUM(v.credits), 0) AS total_credits,
              COUNT(DISTINCT v.pet_id) AS total_voters
       FROM collection_suggestions s
       LEFT JOIN collection_votes v ON v.collection_id = s.id
       GROUP BY s.id, s.chain_id, s.address, s.name, s.created
       ORDER BY total_credits DESC, s.created ASC`
    ).all();
  }

  recordVote(
    collectionId: number,
    petId: string,
    credits: number,
    frensAmount: string,
    created: number
  ): number {
    const result = this.db.prepare(
      'INSERT INTO collection_votes(collection_id, pet_id, credits, frens_amount, created) VALUES(?, ?, ?, ?, ?)'
    ).run(collectionId, petId, credits, frensAmount, created);
    return Number(result.lastInsertRowid);
  }

  getVotesForCollection(collectionId: number): CollectionVoteRow[] {
    return this.db.prepare<CollectionVoteRow>(
      'SELECT id, collection_id, pet_id, credits, frens_amount, created FROM collection_votes WHERE collection_id=?'
    ).all(collectionId);
  }

  getVotesByPet(petId: string): CollectionVoteRow[] {
    return this.db.prepare<CollectionVoteRow>(
      'SELECT id, collection_id, pet_id, credits, frens_amount, created FROM collection_votes WHERE pet_id=?'
    ).all(petId);
  }
}
