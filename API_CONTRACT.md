# BookLeaf Author Support Portal: API Contract (v1)

Source of truth for frontend and backend. If something must change, change this file in BOTH folders and note it in the final summary.

## Conventions
- Base URL: `/api/v1`. JSON only. All timestamps ISO-8601 UTC strings.
- Auth: `Authorization: Bearer <JWT>` on every route except `POST /auth/login` and `GET /health`.
- JWT payload: `{ sub: userId, role: "author" | "admin", authorId?: string }`. Expiry 8h.
- Errors always use this shape (never a bare 500 or HTML):
  `{ "error": { "code": "VALIDATION_ERROR", "message": "Human readable", "details": [ { "field": "subject", "message": "Required" } ] } }`
- Error codes / HTTP: VALIDATION_ERROR 400, UNAUTHENTICATED 401, FORBIDDEN 403, NOT_FOUND 404, CONFLICT 409, RATE_LIMITED 429, AI_UNAVAILABLE 503, INTERNAL_ERROR 500.
- Authors requesting another author's resource get 404 (not 403) to avoid leaking existence.
- Pagination: `?page=1&limit=20` (max 100). List responses: `{ "data": [...], "meta": { "page": 1, "limit": 20, "total": 57 } }`. Single resources: `{ "data": {...} }`.

## Identifiers
- Every resource has an opaque string `id` (database id).
- Books are additionally addressed by their business key `bookId` ("BK001"). Everywhere the API says `bookId` (ticket `bookId`, `POST /tickets` body, `GET /books/:bookId`), it means this business key, NOT the database `id`. Authors are likewise referenced by `authorId` ("AUTH001").

## Enums
- Role: `author`, `admin`
- TicketStatus: `Open`, `In Progress`, `Resolved`, `Closed`
- TicketPriority: `Critical`, `High`, `Medium`, `Low`
- TicketCategory: `Royalty & Payments`, `ISBN & Metadata Issues`, `Printing & Quality`, `Distribution & Availability`, `Book Status & Production Updates`, `General Inquiry`
- AiStatus (classification state): `pending`, `done`, `failed`

## Endpoints

### Health
- `GET /health` -> `{ "status": "ok" }`, or 503 `{ "status": "degraded" }` when the database is disconnected.

### Auth
- `POST /auth/login` body `{ email, password }` -> `{ data: { token, user: User } }`. 401 on bad credentials (same message for unknown email and wrong password). 403 for an admin account whose email isn't `@bookleaf.com`.
- `GET /auth/me` -> `{ data: User }`

User: `{ id, email, name, role, authorId? }`

### Books
- `GET /books` -> Author: own books only. Admin: all books, optional `?authorId=`.
- `GET /books/:bookId` -> Book (author: own only)

Book:
```
{ id, bookId: "BK001", title, isbn, genre, publicationDate: string|null, status: string,
  mrp: number|null, authorRoyaltyPerCopy: number|null, totalCopiesSold: number,
  totalRoyaltyEarned: number, royaltyPaid: number, royaltyPending: number,
  lastRoyaltyPayoutDate: string|null, printPartner: string|null, availableOn: string[],
  authorId: "AUTH001", isInProduction: boolean }
```
Books "In Production - ..." have null mrp/publicationDate and zero royalties. The UI must show "Not yet published" style states, never NaN or "null".

### Tickets
- `POST /tickets` (author) body `{ queryType ("General" | "Account Level"), bookId?: string|null, subject (3-150 chars), description (10-5000 chars), attachments?: [{ name, size }] }`. More than 5 created tickets per author per hour (by default) returns 429 `RATE_LIMITED`; rejected requests do not count.
  - Creates ticket with status `Open`, `aiStatus: "pending"`, returns 201 immediately. AI classification runs in the background and must NEVER block or fail ticket creation.
- `GET /tickets`
  - Author: own tickets only, newest activity first.
  - Admin: all tickets. Query: `authorId`, `status`, `category`, `priority`, `assignedTo` (`me` | userId | `unassigned`), `from`, `to` (date range on createdAt), `q` (search subject), `needsReply` (`true` | `false`), `sort` (`urgency` default | `newest` | `oldest`), `page`, `limit`.
  - `sort=urgency`: unresolved tickets first (Open, In Progress), then by priority (Critical > High > Medium > Low), then oldest createdAt first.
- `GET /tickets/:ticketId` -> Ticket (author: own only). Used for polling.
- `PATCH /tickets/:ticketId` (admin) body any of `{ status, category: TicketCategory|null, priority: TicketPriority|null, assignedTo: userId|null|"me" }`. Setting category/priority to a value sets `categoryOverridden` / `priorityOverridden` to true. Sending `null` for category/priority means "reset to AI": the effective value reverts to `aiCategory`/`aiPriority` and the overridden flag becomes false. Status change to Resolved/Closed sets `resolvedAt`; moving back to Open or In Progress clears it.
- `POST /tickets/:ticketId/responses` (admin) body `{ message (1-5000 chars), usedAiDraft?: boolean, status?: TicketStatus }`. Appends a response visible to the author. Optional `status` updates the ticket atomically (default: Open -> In Progress, otherwise unchanged).
- `POST /tickets/:ticketId/replies` (author, own tickets only) body `{ message (1-5000 chars) }` -> 201 with the AuthorTicket. Lets an author who is not satisfied keep the conversation going while the ticket is `Open` or `In Progress`. The status does not change; `needsReply` becomes true and any cached AI draft is cleared. `Resolved` and `Closed` are final stages: replying returns 409 `CONFLICT`, and the UI should offer "Raise a new ticket". A thread that already has 50 messages also returns 409. Too many replies from one author return 429 `RATE_LIMITED`.
- `POST /tickets/:ticketId/notes` (admin) body `{ text (1-2000) }`. Internal only.
- `POST /tickets/:ticketId/ai-draft` (admin) body `{ regenerate?: boolean, revision?: { previousDraft (1-5000 chars), suggestions (1-1000 chars) } }`. Returns cached draft if present and not regenerating or revising; otherwise generates. On AI failure (outage, rate limit, open circuit, blocked/invalid output) it returns 200 with a template-based starter draft built from the ticket's computed facts, with `fallback: true` and `model: "template"`. Fallback drafts are NOT cached, so the next request tries the AI again. Only if no draft can be produced at all does it return 503 `AI_UNAVAILABLE` with message "AI draft unavailable. You can write a response manually." The frontend treats both as non-fatal. With `revision`, the model always runs and rewrites `previousDraft` as `suggestions` ask, and the result replaces the cached draft. A revision never returns the template: if the model is unavailable it returns 503 `AI_UNAVAILABLE`, so the admin's text is left alone.

### Polling endpoint (near real time)
- `GET /tickets/:ticketId` and `GET /tickets` both include `updatedAt`. Frontend polls every 5s (author ticket list and open ticket) and 10s (admin queue). Backend supports `?updatedSince=<ISO>` on `GET /tickets` to return only changed tickets (empty array when nothing changed).
- `updatedAt` depends on who is asking. Authors get the last change they can see: creation, a reply or a status change. Notes, assignment, category, priority and classification don't move it. Admins get the last activity of any kind.

### Notifications
- `GET /notifications?page&limit` (author) -> `{ data: [ { id, type: "reply"|"status_change", ticketId, ticketNumber, subject, status: TicketStatus|null, message, read, createdAt } ], meta: { page, limit, total, unreadCount } }`, newest first. An admin reply creates one `reply` notification (`status` is set if the reply also changed the status), and a status change through `PATCH /tickets/:ticketId` creates one `status_change`. Notes, assignment, category and priority create nothing. Frontend polls every 5s.
- `POST /notifications/read` (author) body `{ ticketId?: string }` -> `{ data: { updated } }`. Marks that ticket's notifications as read, or all of them if `ticketId` is omitted. Only ever touches the caller's own notifications.

### Admin helpers
- `GET /admin/users` -> list of admins `[{ id, name, email }]` for the assignee dropdown.
- `GET /admin/stats` -> `{ data: { open, inProgress, resolved, closed, critical, unassigned, oldestOpenAt } }`
- `GET /admin/ai-usage?days=30` (admin, `days` 1-365, default 30) -> `{ data: { since, aiEnabled, pricesAsOf, totals: { calls, failures, inputTokens, outputTokens, cacheReadTokens, estimatedCostUsd }, byKind: [ { kind: "classify"|"draft", model, calls, failures, inputTokens, outputTokens, cacheReadTokens, estimatedCostUsd, avgLatencyMs, avgInputTokens, avgOutputTokens } ] } }`. Aggregated from the AI call log (one entry per model call, including failed calls that consumed tokens). Optional for the UI; it is the evidence for AI cost.
- `GET /admin/authors?q=&page&limit` -> `{ data: [AuthorSummary], meta: { page, limit, total } }`, alphabetical by name. `q` matches name, email, author id or city.
- `GET /admin/authors/:authorId` -> `{ data: { ...AuthorSummary, books: [Book] } }`. 404 if there is no such author. For their tickets, use `GET /tickets?authorId=`.

AuthorSummary:
```
{ id, authorId: "AUTH001", name, email, phone: string|null, city: string|null, joinedDate: string|null,
  totals: { books, published, inProduction, copiesSold, royaltyEarned, royaltyPaid, royaltyPending,
            tickets, unresolvedTickets } }
```
`unresolvedTickets` counts `Open` and `In Progress`.

## Ticket shapes

Author view (AuthorTicket), which must NEVER include internal notes, AI fields, or draft:
```
{ id, ticketNumber: "TKT-0001", subject, description, status, bookId: string|null,
  bookTitle: string|null, queryType: "General"|"Account Level"|null, attachments: [{name,size}],
  responses: [ { id, from: "author"|"support", message, authorName, createdAt } ],
  // authorName: "BookLeaf Support" on support replies, the author's own name on theirs.
  createdAt, updatedAt, resolvedAt: string|null }
```
Show category to the author? No. Keep the author view simple.

Admin view (AdminTicket):
```
{ ...AuthorTicket fields, authorId, authorName, authorEmail,
  category, priority, aiCategory, aiPriority, aiReasoning, aiConfidence: number|null,
  categoryOverridden, priorityOverridden, aiStatus,
  assignedTo: { id, name } | null,
  internalNotes: [ { id, text, authorName, createdAt } ],
  aiDraft: { text, generatedAt, model, fallback: boolean, warnings: string[] } | null,
  // warnings: automated checks on the draft (₹ amounts/dates not found in the book record, unfilled [confirm: …] placeholders). Shown to the admin above the editor; may be empty.
  needsReply: boolean,
  // needsReply: the author's follow-up is waiting for an answer. Cleared by a support reply or when the ticket becomes Resolved or Closed.
  responses: [ { id, from: "author"|"support", message, authorName, createdAt, usedAiDraft } ] }
```
`category` / `priority` are the effective values (AI value until an admin overrides). While `aiStatus` is `pending`, category is `General Inquiry` and priority `Medium` as placeholders and the UI shows "Classifying...". `aiConfidence` runs from 0 to 1, and is null when rules produced the classification.

## Seed credentials (created by backend seed script)
- Admin: `admin@bookleaf.com` / `Admin@123` (plus a second admin `ops@bookleaf.com` / `Admin@123`)
- Authors: the email from the dataset (e.g. `priya.sharma@email.com`) / `Author@123`
