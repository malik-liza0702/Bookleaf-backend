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
  apiKey?: string;
  classifyModel: string;
  draftModel: string;
  timeoutMs?: number;
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
  inputTokens: number;
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
  now?: Date;
}

export interface ClassificationResult {
  category: TicketCategory;
  priority: TicketPriority;
  reasoning: string;
  confidence: number | null;
  source: 'ai' | 'rules';
  usage?: AiUsage;
  error?: AiCallError;
}

export interface ThreadMessage {
  from: 'author' | 'support';
  message: string;
  createdAt: string;
}

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
  thread: ThreadMessage[];
  revision?: DraftRevision | undefined;
  now: Date;
}

export interface DraftResult {
  text: string;
  model: string;
  usage: AiUsage;
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
  classifyTicket(input: ClassifyInput): Promise<ClassificationResult>;
  generateDraft(input: DraftInput): Promise<DraftResult>;
}
