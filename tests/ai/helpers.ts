import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { BookContext } from '../../src/ai/index.js';
import {
  ProviderError,
  type AiProvider,
  type GenerateJsonRequest,
  type GenerateRequest,
  type ProviderResult,
} from '../../src/ai/provider.js';

interface RawBook {
  book_id: string;
  title: string;
  isbn: string;
  status: string;
  publication_date: string | null;
  mrp: number | null;
  author_royalty_per_copy: number | null;
  total_copies_sold: number;
  total_royalty_earned: number;
  royalty_paid: number;
  royalty_pending: number;
  last_royalty_payout_date: string | null;
  print_partner: string | null;
  available_on: string[];
}

const dataset = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../data/bookleaf_sample_data.json', import.meta.url)), 'utf8'),
) as { authors: { name: string; books: RawBook[] }[] };

export function book(bookId: string): BookContext {
  const raw = dataset.authors.flatMap((a) => a.books).find((b) => b.book_id === bookId);
  if (!raw) throw new Error(`No book ${bookId} in dataset`);
  return {
    bookId: raw.book_id,
    title: raw.title,
    isbn: raw.isbn,
    status: raw.status,
    isInProduction: raw.status.startsWith('In Production'),
    publicationDate: raw.publication_date,
    mrp: raw.mrp,
    authorRoyaltyPerCopy: raw.author_royalty_per_copy,
    totalCopiesSold: raw.total_copies_sold,
    totalRoyaltyEarned: raw.total_royalty_earned,
    royaltyPaid: raw.royalty_paid,
    royaltyPending: raw.royalty_pending,
    lastRoyaltyPayoutDate: raw.last_royalty_payout_date,
    printPartner: raw.print_partner,
    availableOn: raw.available_on,
  };
}

export const allBookIds = (): string[] => dataset.authors.flatMap((a) => a.books.map((b) => b.book_id));

type Step = ProviderResult | ProviderError | ((req: GenerateRequest) => ProviderResult | ProviderError);

export class FakeProvider implements AiProvider {
  readonly name = 'fake';
  readonly calls: (GenerateRequest | GenerateJsonRequest)[] = [];

  constructor(private readonly steps: Step[]) {}

  generateJson(req: GenerateJsonRequest): Promise<ProviderResult> {
    return this.next(req);
  }

  generateText(req: GenerateRequest): Promise<ProviderResult> {
    return this.next(req);
  }

  private async next(req: GenerateRequest): Promise<ProviderResult> {
    this.calls.push(req);
    const step = this.steps[Math.min(this.calls.length - 1, this.steps.length - 1)]!;
    const outcome = typeof step === 'function' ? step(req) : step;
    if (outcome instanceof ProviderError) throw outcome;
    return outcome;
  }
}

export const usage = { inputTokens: 900, outputTokens: 60, cacheReadTokens: 0 };

export function ok(text: string): ProviderResult {
  return { text, usage };
}

export function json(value: unknown): ProviderResult {
  return ok(JSON.stringify(value));
}

export const noSleep = async () => {};

export const NOW = new Date('2026-10-26T10:00:00Z');
