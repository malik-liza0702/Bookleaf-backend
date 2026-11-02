# BookLeaf Author Support Portal: Backend

REST API for BookLeaf's author support portal. Authors raise and follow tickets about their books. The support team gets a triage queue sorted by urgency, AI classification, AI-drafted replies grounded in BookLeaf policy, and internal notes.

**Stack:** Node 22 · TypeScript (strict) · Express 5 · MongoDB 7 + Mongoose 9 · Zod · JWT + bcrypt · Google Gemini (`@google/genai`) · pino · Vitest + supertest + mongodb-memory-server

- API contract (source of truth): [`API_CONTRACT.md`](./API_CONTRACT.md)
- Interactive docs: **http://localhost:4000/api/docs** (raw spec: `/api/docs/openapi.json`)
- Full endpoint reference: [`docs/API_REFERENCE.md`](./docs/API_REFERENCE.md)
- AI module deep dive: [`src/ai/README.md`](./src/ai/README.md)
- Frontend: [`../frontend/README.md`](../frontend/README.md)

---

## Quick start

```bash
cp .env.example .env          # set MONGODB_URI (Atlas) and JWT_SECRET; GEMINI_API_KEY is optional
npm install
npm run db:seed               # idempotent: 2 admins, 10 authors, 18 books (no tickets)
npm run dev                   # http://localhost:4000
```

| Script | What it does |
|---|---|
| `npm run dev` | Watch mode (tsx), loads `.env` |
| `npm run build` / `npm start` | Compile to `dist/` / run the compiled server |
| `npm run db:seed` | Seed from `data/bookleaf_sample_data.json` (`db:seed:prod` runs the compiled seed) |
| `npm test` | Whole suite against an in-memory MongoDB (no Docker needed) |
| `npm run typecheck` / `npm run lint` | `tsc --noEmit` / ESLint over `src` and `tests` |

### Seed logins

| Role | Email | Password |
|---|---|---|
| Admin | `admin@bookleaf.com` (Aisha Verma) | `Admin@123` |
| Admin | `ops@bookleaf.com` (Karan Mehta) | `Admin@123` |
| Author | any dataset email, e.g. `priya.sharma@email.com`, `ananya.reddy@email.com` | `Author@123` |

The seed creates only users and books. There are no tickets until authors raise them in the app. Each author can create 5 tickets an hour, so when testing heavily, switch to another seeded author or raise `TICKET_RATE_LIMIT_MAX`.

### Environment variables

| Variable | Required | Default | Notes |
|---|---|---|---|
| `MONGODB_URI` | yes | n/a | an Atlas `mongodb+srv://` URI |
| `MONGODB_DB_NAME` | | `bookleaf` | database to use; overrides any database named in the URI |
| `JWT_SECRET` | yes | n/a | at least 32 characters (`openssl rand -base64 48`) |
| `JWT_EXPIRES_IN` | | `8h` | |
| `PORT` | | `4000` | |
| `NODE_ENV` | | `development` | `production` gives JSON logs and hides internal error messages |
| `LOG_LEVEL` | | `info` | |
| `CORS_ORIGIN` | | `http://localhost:5173` | comma-separated allow-list |
| `TICKET_RATE_LIMIT_MAX` / `_WINDOW_MS` | | `5` / `3600000` | per author, on `POST /tickets`; only created tickets count |
| `REPLY_RATE_LIMIT_MAX` / `_WINDOW_MS` | | `20` / `900000` | per author, on `POST /tickets/:ticketId/replies` |
| `GEMINI_API_KEY` | no | n/a | unset means degraded mode (see below); read from the environment only and never logged |
| `AI_CLASSIFY_MODEL` | | `gemini-3.5-flash-lite` | |
| `AI_DRAFT_MODEL` | | `gemini-3.8-flash` | |
| `AI_TIMEOUT_MS` / `AI_MAX_RETRIES` | | `15000` / `2` | per-attempt timeout; retries on 429, 5xx and timeouts |

The config is validated with Zod at boot (`src/config/env.ts`). The process refuses to start with a readable list of problems rather than failing on the first request.

---

## Architecture

```
src/
  server.ts           boot: config → DB → container → re-queue pending → listen; graceful shutdown
  app.ts              Express app (helmet, CORS, JSON limit, pino-http, docs, routes, errors), no side effects
  container.ts        composition root: builds repositories, services, the AI service and the queue
  config/env.ts       Zod-validated environment
  routes/index.ts     the whole route table: auth, RBAC and validation for every endpoint in one file
  middleware/         authenticate + requireRole, validate (Zod), ticket and reply rate limits, error handler
  controllers/        HTTP in and out only
  services/           business rules (tickets, drafts, classification, auth, books, admin, AI call recording)
  repositories/       all MongoDB queries; keeps the derived fields consistent
  models/             Mongoose schemas and indexes
  mappers/            DTO serializers: separate AuthorTicket and AdminTicket mappers
  schemas/            Zod request schemas
  jobs/               in-process classification queue
  ai/                 AI module: pure, no DB, no Express, no env (see src/ai/README.md)
  seed/seed.ts        idempotent seed
  docs/openapi.yaml   hand-written OpenAPI 3 spec
```

**Why it's laid out this way**
- **Layers** go routes → controllers → services → repositories → models. Each layer has one job, so a reviewer can find "who decides X" quickly. Services don't know about HTTP; repositories don't know about roles.
- **Constructor injection, with one composition root** (`container.ts`). Tests build the real app with a fake LLM provider and no mocking framework. Only one AI service exists per process, because it holds the circuit breaker.
- **The AI module is pure.** It takes plain inputs (ticket, book facts, thread) and returns plain outputs (classification, draft, usage, error). The core persists results and writes the cost log. Swapping Gemini for another vendor means one new class behind the `AiProvider` interface (`src/ai/provider.ts`).
- **Errors** always have the shape `{ error: { code, message, details? } }`. The error handler maps:

  | Source | Response |
  |---|---|
  | `AppError` | as thrown |
  | Zod errors | `VALIDATION_ERROR` with per-field details |
  | Mongoose validation or cast errors | 400 |
  | Duplicate key (11000) | 409 `CONFLICT` |
  | Malformed JSON | 400 |
  | Unknown routes | 404 |

  Anything unexpected is logged with its stack and returned as a generic `INTERNAL_ERROR`. Stack traces never reach clients, and in production the original message is hidden too.
- **Security:**
  - helmet, a CORS allow-list and a 100 kb body limit;
  - bcrypt hashing, plus a dummy compare for unknown emails, so both login failures take the same time and return the same message;
  - per-author rate limits on new tickets and on replies;
  - JWTs pinned to HS256 with the payload validated;
  - Mongoose `strictQuery` and escaped search input, so there's no regex or operator injection;
  - authors get 404 for other authors' tickets and books, so existence never leaks.

---

## Data model (MongoDB)

| Collection | Contents | Key indexes |
|---|---|---|
| `users` | email (unique), bcrypt `passwordHash`, name, role `author`/`admin` | `email` unique, `role` |
| `authors` | `authorId` (AUTH001), `user` ref, phone, city, joinedDate | `authorId` unique, `user` unique |
| `books` | every dataset field, money in whole rupees (as in the dataset), `authorId` | `bookId` unique, `authorId` |
| `tickets` | the ticket, with embedded `responses[]`, `internalNotes[]` and `aiDraft` | see below |
| `counters` | named sequences (`ticketNumber`) | `_id` |
| `aiCallLogs` | one document per AI call: kind, model, tokens, cache hits, cost, latency, success, error code | `createdAt`, `ticketId`, `{kind, createdAt}` |
| `notifications` | one document per reply or status change an author should hear about, with `readAt` | `{user, createdAt}`, `{user, readAt}` |

**Design choices**
- **Books get their own collection** rather than being embedded in authors, because admins query them across authors and tickets reference them one at a time. Tickets store the business keys (`authorId: "AUTH001"`, `bookId: "BK001"`) because the contract exposes those everywhere, so most reads need no join. The book title is filled in with a virtual populate on `bookId`.
- **Responses, internal notes and the cached draft are embedded in the ticket.** They're small, bounded per ticket, always read with it and never queried alone. Embedding also makes "append a reply + change the status + drop the stale draft" one atomic `updateOne`, with no multi-document transaction (which would need a replica set). The admin's name is copied into each reply or note, like an email "From" line, so rendering a thread needs no lookups. A 16 MB document holds thousands of replies, far beyond a support thread.
- **Ticket numbers** (`TKT-0001`) come from an atomic `$inc` with upsert on `counters`, which is safe under concurrent creates.
- **`updatedAt` drives polling.** Every write path goes through Mongoose update queries with `timestamps: true`, so `$set` and `$push` both bump it. That includes replies, notes, status, assignment and classification; the classification pipeline sets `$$NOW` explicitly. The one deliberate exception is caching an AI draft (`timestamps: false`): drafts are admin-only, so generating one shouldn't make every poller refetch.
- **Authors get their own `updatedAt`.** Their view of the field comes from `authorUpdatedAt`, which only moves on creation, a reply or a real status change, so admin-only work never shows up as "Updated just now". It also drives the author's list order and `?updatedSince=`. Tickets older than the field are backfilled on boot from the latest of creation, last reply and resolution.
- **The urgency sort uses stored rank fields** (`statusRank`: 0 for unresolved, 1 for resolved; `priorityRank`: Critical 0 to Low 3), backed by the index `{statusRank, priorityRank, createdAt}`. MongoDB can then serve the default queue sort straight from the index and paginate with `skip`/`limit`. The alternative, an aggregation that computes ranks per query, can't use an index for that sort and is harder to read. The cost is keeping the ranks in sync: every write goes through `ticket.repository.ts`, where `statusFields()` and `priorityFields()` set the label, the rank and `resolvedAt` together.
- **Other ticket indexes:**
  - `{status, priority, createdAt}` for admin filters;
  - `{authorId, authorUpdatedAt}` for the author's list, newest visible update first;
  - `{updatedAt}` for `?updatedSince=`;
  - `{createdAt}`;
  - `{assignedTo}`;
  - `{needsReply}` for the admin filter;
  - `{aiStatus}` for crash recovery.
- **Ids:** malformed ObjectIds in a path return 404 before any query runs, never a `CastError` 500. Serializers expose `id` strings and never `_id` or `__v`.
- **Classification state:**
  - `category` and `priority` are the effective values.
  - `aiCategory`, `aiPriority`, `aiReasoning` and `aiConfidence` hold what the classifier said.
  - `categoryOverridden` and `priorityOverridden` are set when an admin picks a value. `null` in a PATCH resets to the AI value.
  - A classification that lands after an override never clobbers it: the check runs inside a single pipeline update (`$cond` on the override flag).

---

## API overview

Base path `/api/v1`; full details in the [contract](./API_CONTRACT.md) and at `/api/docs`.

| Method and path | Who | Notes |
|---|---|---|
| `GET /health` | public | `{ status: "ok" }`, or 503 `{ status: "degraded" }` if the database is down |
| `POST /auth/login`, `GET /auth/me` | public / any | JWT valid for 8 h |
| `GET /books`, `GET /books/:bookId` | author (own), admin (all, `?authorId=`) | `isInProduction` derived from the status |
| `POST /tickets` | author | 201 immediately; classification queued; 5 per hour per author |
| `GET /tickets` | author (own) / admin | filters, `sort=urgency\|newest\|oldest`, `q` (subject or `TKT-0007`), `authorId` (admin), `updatedSince`, pagination |
| `GET /tickets/:id` | owner / admin | AuthorTicket vs AdminTicket shape |
| `PATCH /tickets/:id` | admin | status, category, priority (null resets to AI), assignee (`me`, an id, or null) |
| `POST /tickets/:id/responses` | admin | atomic append and status change (default: Open → In Progress) |
| `POST /tickets/:id/replies` | author (own) | follow-up while Open or In Progress; sets `needsReply`; 409 once Resolved or Closed; rate limited |
| `POST /tickets/:id/notes` | admin | internal only |
| `POST /tickets/:id/ai-draft` | admin | cached; `regenerate: true` forces a new one; `revision` applies admin suggestions to the current draft; template fallback, except for revisions |
| `GET /notifications` | author (own) | newest first, with `meta.unreadCount`; created by replies and status changes only |
| `POST /notifications/read` | author (own) | marks one ticket's notifications as read, or all of them |
| `GET /admin/users`, `GET /admin/stats` | admin | assignee list; queue counters |
| `GET /admin/authors?q=`, `GET /admin/authors/:authorId` | admin | authors with book, royalty and ticket totals; the detail adds their books |
| `GET /admin/ai-usage?days=30` | admin | token, cache and cost aggregates from `aiCallLogs` |

The author view is built from an allow-list (`mappers/ticket.mapper.ts`) and the query never loads the internal fields (`AUTHOR_VIEW_FIELDS`). Notes, AI fields, drafts and the assignee can't leak, and every reply is signed "BookLeaf Support".

---

## AI integration (Google Gemini)

The full design, prompts and measurements are in [`src/ai/README.md`](./src/ai/README.md). The AI module was built as a separate, pure module behind `AI_MODULE_CONTRACT.md`; this section covers how it works and how the backend uses it.

### What it does
1. **Auto-classification.** `POST /tickets` returns 201 first. `ClassificationQueue` (in process, concurrency 2) then calls `classifyTicket`, which returns category, priority, a short reasoning and a confidence from 0 to 1.
   - Gemini structured output: `responseMimeType: application/json` plus a schema with enums, validated with Zod.
   - The prompt is small: category definitions, the priority rubric and 3 to 5 lines of computed book facts (status, royalty status, months since publication). It never includes the KB.
   - Policy floors are enforced in code after the model: ISBN error ⇒ High or above; legal threat ⇒ Critical; possibly overdue royalty ⇒ High or above.
   - On boot, every ticket still `pending` is re-queued (crash recovery).
2. **AI-drafted replies.** `POST /tickets/:id/ai-draft` runs lazily when an admin opens a ticket. The draft is stored on the ticket, reused until `regenerate: true`, and cleared when an admin replies. Context is assembled per ticket:
   - always the tone guidelines and company overview (a stable system instruction);
   - only the KB policy section and sample-reply row for the ticket's category, plus at most one secondary section;
   - facts computed in code: earned, paid and pending amounts; the next scheduled payout (quarter end + 45 days); the ₹1,000 threshold rollover; production stage;
   - the last 3 public messages, each truncated. Never internal notes.
   - Author text is fenced in tags, its delimiters are defanged, and the model is told to treat it as data.
   - Missing facts become `[confirm: …]` placeholders.
   - An admin can ask for changes: `revision` sends the current text and their suggestions, and the model returns an updated draft that replaces the cached one. Facts stated in the suggestions count as verified, though `warnings[]` still flags any amount or date that isn't in the record. If the model is unavailable, a revision returns 503 rather than the template, so the admin's text isn't overwritten.
   - The output is a plain-text reply that acknowledges first, is specific, gives a timeline and a next step, and is signed "BookLeaf Author Support". `warnings[]` flags amounts or dates that aren't in the record, and unfilled placeholders, for the admin to check.
   - If the ticket is still being classified, the draft picks its KB section with the free rules classifier instead of the "General Inquiry" placeholder.
3. **Payments are never asserted late.** The book record shows a pending amount but not when it was earned, so the module can't know whether a payout deadline has actually passed. The royalty fact is `possibly_overdue`, not "overdue". Drafts and templates use conditional ownership ("if this should already have reached you, that's on us; finance will confirm within 48 hours"), and every royalty reply includes the next scheduled payout date. Triage still floors these tickets at High, so they're seen quickly.

### Model choice
| Task | Model | Why |
|---|---|---|
| Classify | `gemini-3.5-flash-lite` | A short, enum-constrained, high-volume task. It's the cheapest current stable model Google recommends for new projects ($0.30 / $2.50 per 1M tokens in/out), fast with minimal thinking, and supports structured JSON output. |
| Draft | `gemini-3.8-flash` | The text goes to an author, so tone and policy accuracy matter. It's the most capable stable Flash model ($0.75 / $3.75 per 1M until 2026-12-31, then $1.50 / $7.50), roughly 10× cheaper than Pro-class models, and fast enough to show a draft when the ticket opens. |

Both models have a free tier, which covers development but not a demo: on 2026-11-01 it allowed 20 requests a day for `gemini-3.8-flash` and 15 a minute for `gemini-3.5-flash-lite`. Past those limits the app falls back to templates and rules, so enable billing on the key for anything evaluators will use. Both models are env-configurable, so changing models needs no code change. Thinking is set explicitly (`minimal` for classify, `low` for drafts), and no `temperature` is sent (deprecated on Gemini 3.x).

### Cost controls (and honest numbers)
- **Measured per-call cost** from real Gemini calls on 2026-11-01 and 2026-11-02 (`GET /admin/ai-usage`):
  - classify on `gemini-3.5-flash-lite`: about 1,130 to 1,260 input and 50 to 60 output tokens, about **$0.0005**;
  - draft on `gemini-3.6-flash`, which costs the same as 3.8 Flash: about 1,770 to 1,970 input and 1,330 to 1,570 output tokens (most of the output is thinking), about **$0.006 to $0.0075**;
  - per ticket: about $0.007 to $0.008, or roughly $8 per 1,000 tickets. That rises to roughly $15 when the 3.x Flash promotional rate ends on 2026-12-31.
- **What is never sent:** the entire KB on every call, other tickets, or the whole history.
- **Measured, not guessed:** every call writes an `aiCallLogs` document with input, output and cache-read tokens, latency, success or error code, and `estimatedCostUsd`, priced with the module's dated price table (`PRICES_AS_OF`). `GET /admin/ai-usage` aggregates them by kind and model. Failed calls that consumed tokens (blocked, truncated, invalid JSON) are logged too.
- **Caching:** Gemini implicit caching applies to a stable prompt prefix of at least **4,096 tokens** on 3.8 Flash. These prompts are about 1,400 tokens, so they get no discount today. The system instructions are still kept byte-identical and first, so caching starts working on its own if the KB grows. Explicit `cachedContents` isn't used, because its per-hour storage charge would outweigh the savings at this prompt size.
- **What real calls have verified:**
  - Classification ran on its default model and got 12 of 12 hand-written tickets right: the category on all of them, and the expected priority range on the 6 that had one. They were the brief's sample queries plus a prompt injection, a Hinglish ticket and a legal threat. That's a sanity check, not an accuracy measurement.
  - Drafts and a revision ran on `gemini-3.6-flash`, because the free-tier daily quota for `gemini-3.8-flash` was used up. **Drafts on the default 3.8 Flash still need checking.**
  - The automated suite exercises every AI path against a scripted fake provider through the real service (retries, circuit breaker, validation and fallbacks).
  - `tests/ai/gemini.smoke.test.ts` makes three real calls and prints their tokens and cost when you run `GEMINI_API_KEY=... npx vitest run tests/ai/gemini.smoke.test.ts`.

### Degradation layers (the app never depends on the model)
1. **Retries:** bounded backoff with jitter on 429 `RESOURCE_EXHAUSTED`, 5xx `UNAVAILABLE` and timeouts. Each attempt has its own timeout, and a server retry delay is honoured. The SDK's own retries are off, so there's one loop.
2. **Circuit breaker:** after 5 consecutive provider failures, AI calls pause for 60 s. Safety blocks and `MAX_TOKENS` count as failures for that call but don't trip the breaker.
3. **Fallbacks:**
   - Classification uses the deterministic rules classifier, stored with `aiStatus: "failed"` and a reasoning that says rules were used. The ticket stays fully usable.
   - Drafts get a template starter reply built from the same facts: 200 with `fallback: true` and `model: "template"`. It isn't cached, so the next open retries the model.
4. **Manual:** if even the template can't be built, the endpoint returns 503 `AI_UNAVAILABLE`. Admins can always reply by hand.

**With no `GEMINI_API_KEY`** the app boots with a clear warning. Tickets are rule-classified and drafts are templates. Running the built app with no key and with an invalid key confirmed that ticket creation, template drafts and manual replies all keep working, and that revisions return 503.

---

## Testing

`npm test` runs everything against `mongodb-memory-server`, a fresh database per test file. The API tests drive the real Express app and the real AI service around a fake Gemini provider. They cover:
- login success and failure (same message for unknown email and wrong password);
- RBAC: 403 for authors on every admin route; 404 for another author's ticket or book, and for malformed ids;
- the author payload has exactly the allowed keys (no notes, AI fields, draft or assignee);
- `POST /tickets` returns 201 when the provider throws, and the rules result is stored as `failed`, with a failure in `aiCallLogs`;
- the AI success path, including logged tokens and cost;
- the validation error shape;
- foreign or unknown `bookId` returns a 400 on `bookId`;
- the ticket creation limit: per author, with rejected requests not counted;
- urgency sort order;
- override flags, including an override that survives a late classification and `null` resetting to AI;
- a reply moves Open to In Progress and bumps `updatedAt`; resolved and reopened tickets set and clear `resolvedAt`;
- author replies: allowed while Open or In Progress, 409 once Resolved or Closed, `needsReply` set and cleared, and the AI draft sees the follow-up;
- `updatedSince` polling, filters, and regex-safe search;
- the author's `updatedAt` and list order ignore admin-only changes, and existing tickets are backfilled;
- the draft is cached and only regenerated on request; the template fallback isn't cached and carries warnings; the draft is cleared after a reply; a revision sends the previous draft and suggestions to the model, and a failed one returns 503 and keeps the cached draft;
- a reply or status change notifies only the ticket's author, admin-only changes don't, and a failed notification write doesn't fail the reply;
- crash-recovery re-queueing.

`tests/ai` holds the AI module's own unit tests: date maths, the rules classifier, retries and the breaker, KB selection, injection defanging and draft checks. The frontend has no automated tests.

---

## Deployment

- **Database:** MongoDB Atlas free tier (M0). Put the `mongodb+srv://…` string in `MONGODB_URI`, and allow the host's egress IPs, or 0.0.0.0/0 for a demo.
- **API:** Render or Railway, as a plain Node service with `npm ci && npm run build` and `npm start`. Set `NODE_ENV=production`, `JWT_SECRET`, `MONGODB_URI` and `CORS_ORIGIN` (the frontend URL), plus `GEMINI_API_KEY` (with billing enabled for a demo; see [Model choice](#model-choice)). The platform's `PORT` is respected.
- **Frontend:** see [its deployment notes](../frontend/README.md#deployment). Set `VITE_API_BASE_URL` at build time, and add the frontend's URL to `CORS_ORIGIN`.
- **Secrets:** `.env` is git-ignored and `.env.example` is committed, so real values only ever go in `.env` or the host's settings.
- **Seed once:** `npm run db:seed:prod` (it's idempotent).
- **Indexes:** Mongoose builds them on startup (`autoIndex`), and the seed calls `syncIndexes()`.

---

## Known limitations and next steps

- **Attachments are metadata only** (name and size). Real uploads would go to object storage (S3/R2) with signed URLs and virus scanning.
- **The queue lives in memory.** It's fine for one instance, with crash recovery through re-queue on boot. Several instances would need a shared queue (BullMQ/Redis or Mongo-based job leasing) so two workers don't classify the same ticket.
- **Rate limits are simple.** Counters live in memory, so a restart clears them and each instance counts separately. The ticket limit is a fixed hour from the author's first ticket, so 5 just before a reset and 5 just after are both allowed. Login has no rate limit, so nothing slows password guessing; add one back before real use.
- **Polling, not push.** It's simple and robust at this scale. SSE or WebSockets would cut latency and load.
- **Text search** uses an escaped, case-insensitive regex on `subject`. At scale, use a MongoDB text index or Atlas Search.
- **Other gaps:**
  - No refresh tokens or token revocation (8-hour JWT expiry).
  - No audit log of status changes beyond `updatedAt`.
  - No SLA timers. Notifications are in-app only: an email when a reply lands would hang off `NotificationService.notifyAuthor`.
- **AI:**
  - Drafts on the default `gemini-3.8-flash` haven't been run for real yet (see [cost controls](#cost-controls-and-honest-numbers)).
  - A cached draft isn't cleared when an admin overrides the category, so it can reflect the old category's policy until someone clicks Regenerate.
  - A ticket that falls back to rules during a rate limit stays that way: nothing retries it, and there's no re-classify action. Admins can still override it.
  - One circuit breaker covers both models, though Gemini's quotas are per model. Five failed draft calls in a row (say, the daily quota running out) also send new tickets to the rules classifier for 60 s.
  - Next steps: an eval set of labelled tickets to measure classification accuracy; feeding admin overrides back as few-shot examples; capturing how much admins edit drafts before sending (`usedAiDraft` is already recorded per reply).
