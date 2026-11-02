# AI Module Contract (internal, backend only)

Two sessions build the backend at the same time. This file fixes the seam between them.

## Ownership
- **AI session (bookleaf-97)** owns `src/ai/**` and `tests/ai/**`. Nothing else.
- **Core session (main backend agent)** owns everything else: `package.json`/lockfile, `prisma/`, config/env loading, Express app, routes, middleware, services, seed, OpenAPI, README.
- Need a dependency? The AI session asks the core session; it never edits `package.json` and never runs `npm install <pkg>`. `@google/genai` and `zod` are core dependencies.
- The AI module is **pure**: no Prisma, no Express, no `process.env`. It takes plain inputs and returns plain outputs. The core session persists results and writes `AiCallLog` rows from the `usage`/`error` fields.

## Stack
TypeScript (strict, ESM per core tsconfig), `@google/genai`, `zod` for parsing model output, vitest. The core session's package.json defines the versions.

## Public API: `src/ai/index.ts`
```ts
export type TicketCategory =
  | 'Royalty & Payments' | 'ISBN & Metadata Issues' | 'Printing & Quality'
  | 'Distribution & Availability' | 'Book Status & Production Updates' | 'General Inquiry';
export type TicketPriority = 'Critical' | 'High' | 'Medium' | 'Low';

export interface AiConfig {
  apiKey?: string;            // undefined → disabled mode (classify uses rules, draft throws AiUnavailableError)
  classifyModel: string;      // e.g. from AI_CLASSIFY_MODEL
  draftModel: string;         // e.g. from AI_DRAFT_MODEL
  timeoutMs?: number;         // default 15000
  maxRetries?: number;        // default 2
}

export interface BookContext {
  bookId: string; title: string; isbn: string; status: string; isInProduction: boolean;
  publicationDate: string | null; mrp: number | null; authorRoyaltyPerCopy: number | null;
  totalCopiesSold: number; totalRoyaltyEarned: number; royaltyPaid: number; royaltyPending: number;
  lastRoyaltyPayoutDate: string | null; printPartner: string | null; availableOn: string[];
}

export interface AiUsage {
  model: string; inputTokens: number; outputTokens: number; cacheReadTokens: number; latencyMs: number;
}

export interface AiCallError { code: 'NO_API_KEY' | 'RATE_LIMITED' | 'UNAVAILABLE' | 'TIMEOUT' | 'BLOCKED' | 'INVALID_OUTPUT' | 'UNKNOWN'; message: string }

export interface ClassifyInput {
  subject: string; description: string; book: BookContext | null;
}
export interface ClassificationResult {
  category: TicketCategory; priority: TicketPriority;
  reasoning: string;          // one or two sentences, shown to admins
  confidence: number | null;  // 0..1 from the model; null for rules
  source: 'ai' | 'rules';     // 'rules' → core sets aiStatus "failed"
  usage?: AiUsage;            // present when a model call completed
  error?: AiCallError;        // present when the AI path failed and rules were used
}

export interface DraftInput {
  ticket: {
    ticketNumber: string; subject: string; description: string; status: string;
    category: TicketCategory; priority: TicketPriority; createdAt: string;
  };
  author: { name: string; city?: string | null };
  book: BookContext | null;
  // Chronological; core passes at most the last 6 public messages. Never internal notes.
  thread: { from: 'author' | 'support'; message: string; createdAt: string }[];
  now: Date;                  // injected for deterministic date math and tests
}
export interface DraftResult { text: string; model: string; usage: AiUsage }

export class AiUnavailableError extends Error { readonly code: AiCallError['code']; readonly usage?: AiUsage }

export interface AiService {
  readonly enabled: boolean;
  classifyTicket(input: ClassifyInput): Promise<ClassificationResult>; // NEVER throws: falls back to rules
  generateDraft(input: DraftInput): Promise<DraftResult>;              // throws AiUnavailableError on failure
}

export function createAiService(config: AiConfig, deps?: { provider?: AiProvider }): AiService;
export function classifyByRules(input: ClassifyInput): ClassificationResult; // exported for tests and seed
export function nextRoyaltyPayout(now: Date): { quarterEnd: string; payoutBy: string }; // quarter end + 45 days
```
### Additions (v1.1, all backward compatible)
- `ClassifyInput.now?: Date`: optional clock for the payout facts. Defaults to the current time.
- `DraftResult.warnings: string[]`: review hints for the admin, e.g. a ₹ amount or date in the draft that isn't in the book record, or unfilled `[confirm: …]` placeholders. Always present; empty when there are none. Worth showing above the draft editor.
- `AiUnavailableError` constructor: `(code, message, usage?)`, matching the core stub. Its message is the contract text "AI draft unavailable. You can write a response manually."
- New exports from `index.ts`:
  - `buildFallbackDraft(input: DraftInput): FallbackDraft` where `FallbackDraft = { text: string; warnings: string[] }` (v1.2: was `string`): a template starter reply filled from the computed facts, for `aiDraft.fallback: true` when the AI is unavailable. Its `warnings` run the same checks as AI drafts (unfilled placeholders, unknown ₹ amounts or dates); return them as `aiDraft.warnings`.
- v1.2 behaviour: royalty status `likely_overdue` is now `possibly_overdue`. Neither drafts nor templates state that a payment is late: ownership is conditional, with a 48-hour finance confirmation and the next scheduled payout date.
  - `estimateCostUsd(usage, override?: ModelPrice, at?: Date): number | null`, `priceFor(model, at?)` and `PRICES_AS_OF`: dated Gemini prices (paid tier, Standard, from ai.google.dev pricing, last updated 2026-10-22). Use these to fill `AiCallLog.estimatedCostUsd`. `override` lets env prices win.
  - `TICKET_CATEGORIES`, `TICKET_PRIORITIES`, `ProviderError`, and the type `AiServiceDeps` (`{ provider?, sleep?, clock?, breaker? }`, the second argument of `createAiService`).
- Recommended defaults: `AI_CLASSIFY_MODEL=gemini-3.5-flash-lite`, `AI_DRAFT_MODEL=gemini-3.8-flash` (both stable per ai.google.dev/gemini-api/docs/models, last updated 2026-10-22).

`AiProvider` is the low-level interface (`generateJson`, `generateText`) with `GeminiProvider` as its one implementation. Tests inject a fake provider.

## Behaviour the AI session implements
- Classification: Gemini structured output (`responseMimeType: application/json` + `responseJsonSchema` with enums), Zod-validated, no sampling parameters (deprecated on Gemini 3.x), small prompt (category definitions + priority rubric + minimal book facts). No full KB.
- Draft: the KB is split into sections by category. Always send tone + company overview, and only the relevant policy section(s) and samples. The stable prefix goes in `systemInstruction` (implicit caching). Facts are computed in code (next payout date, ₹1,000 threshold rollover, in-production stage) and passed in. Author text is wrapped in delimiters as untrusted. No invented facts; use `[confirm: ...]` placeholders. Sign-off is "BookLeaf Author Support". `DraftInput.revision` (`{ previousDraft, suggestions }`) asks the model to revise that draft; facts in the suggestions count as verified.
- Retries: bounded backoff on 429/503/timeouts. Safety blocks and non-STOP finish reasons count as failures.

## Core session wiring
- `config` builds `AiConfig` from `GEMINI_API_KEY`, `AI_CLASSIFY_MODEL`, `AI_DRAFT_MODEL`.
- The ticket service calls `classifyTicket` in the background after the 201 response, persists the result (`source: 'rules'` → `aiStatus: "failed"`), and writes `AiCallLog`.
- The draft endpoint calls `generateDraft`, caches the result and logs it. On `AiUnavailableError` it serves an uncached `buildFallbackDraft` template. It returns 503 `AI_UNAVAILABLE` only for a failed revision, or if the template can't be built.
- Until `src/ai/index.ts` exists, the core session may code against these types with a temporary stub. It deletes the stub when the real module lands, and does not write its own Gemini code.
