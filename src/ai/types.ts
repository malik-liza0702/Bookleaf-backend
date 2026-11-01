/**
 * Public types of the AI module. They mirror AI_MODULE_CONTRACT.md; the core
 * backend imports them from './ai/index.js' and never reaches into other files.
 */

export const TICKET_CATEGORIES = [
  'Royalty & Payments',
  'ISBN & Metadata Issues',
  'Printing & Quality',
  'Distribution & Availability',
  'Book Status & Production Updates',
  'General Inquiry',
] as const;
export type TicketCategory = (typeof TICKET_CATEGORIES)[number];

export const TICKET_PRIORITIES = ['Critical', 'High', 'Medium', 'Low'] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

export interface AiConfig {
  /** undefined or empty → disabled mode: classify uses rules, draft throws AiUnavailableError. */
  apiKey?: string;
  classifyModel: string;
  draftModel: string;
  /** Per-attempt timeout. Default 15000. */
  timeoutMs?: number;
  /** Retries after the first attempt on 429/503/timeouts. Default 2. */
  maxRetries?: number;
}

export interface BookContext {
  bookId: string;
  title: string;
  isbn: string;
  status: string;
  isInProduction: boolean;
  publicationDate: string | null;
  mrp: number | null;
  authorRoyaltyPerCopy: number | null;
  totalCopiesSold: number;
  totalRoyaltyEarned: number;
  royaltyPaid: number;
  royaltyPending: number;
  lastRoyaltyPayoutDate: string | null;
  printPartner: string | null;
  availableOn: string[];
}

export interface AiUsage {
  model: string;
  /** Prompt tokens, including any served from cache. */
  inputTokens: number;
  /** Visible output plus thinking tokens (both are billed as output). */
  outputTokens: number;
  cacheReadTokens: number;
  latencyMs: number;
}

export type AiErrorCode =
  | 'NO_API_KEY'
  | 'RATE_LIMITED'
  | 'UNAVAILABLE'
  | 'TIMEOUT'
  | 'BLOCKED'
  | 'INVALID_OUTPUT'
  | 'UNKNOWN';

export interface AiCallError {
  code: AiErrorCode;
  message: string;
}

export interface ClassifyInput {
  subject: string;
  description: string;
  book: BookContext | null;
  /** Optional clock for the payout facts; defaults to the current time. */
  now?: Date;
}

export interface ClassificationResult {
  category: TicketCategory;
  priority: TicketPriority;
  /** One or two sentences, shown to admins. */
  reasoning: string;
  /** 0..1 from the model; null for rules. */
  confidence: number | null;
  /** 'rules' → the core sets aiStatus "failed". */
  source: 'ai' | 'rules';
  /** Present when a model call completed. */
  usage?: AiUsage;
  /** Present when the AI path failed and rules were used. */
  error?: AiCallError;
}

export interface ThreadMessage {
  from: 'author' | 'support';
  message: string;
  createdAt: string;
}

/** An admin's request to rework a draft: the current text and what to change in it. */
export interface DraftRevision {
  previousDraft: string;
  suggestions: string;
}

export interface DraftInput {
  ticket: {
    ticketNumber: string;
    subject: string;
    description: string;
    status: string;
    category: TicketCategory;
    priority: TicketPriority;
    createdAt: string;
  };
  author: { name: string; city?: string | null };
  book: BookContext | null;
  /** Chronological public messages, never internal notes. Only the last few are sent. */
  thread: ThreadMessage[];
  /** Present when an admin asked for changes: the model revises this draft instead of starting over. */
  revision?: DraftRevision | undefined;
  /** Injected for deterministic date math and tests. */
  now: Date;
}

export interface DraftResult {
  text: string;
  model: string;
  usage: AiUsage;
  /**
   * Things the admin should double-check before sending, e.g. a rupee amount in
   * the draft that does not appear in the book record. Empty when nothing was found.
   */
  warnings: string[];
}

export class AiUnavailableError extends Error {
  constructor(
    readonly code: AiErrorCode,
    message: string,
    readonly usage?: AiUsage,
  ) {
    super(message);
    this.name = 'AiUnavailableError';
  }
}

export interface AiService {
  readonly enabled: boolean;
  /** Never throws: falls back to the rules classifier. */
  classifyTicket(input: ClassifyInput): Promise<ClassificationResult>;
  /** Throws AiUnavailableError on failure; the core maps it to 503 AI_UNAVAILABLE. */
  generateDraft(input: DraftInput): Promise<DraftResult>;
}
