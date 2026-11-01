# BookLeaf API Reference

Every endpoint in the BookLeaf Author Support Portal backend: what it is for, who may call it, what it accepts and returns, and what it changes.

- **Base URL:** `http://localhost:4000/api/v1` in development.
- **Interactive docs:** Swagger UI at `/api/docs`, raw spec at `/api/docs/openapi.json`. Both sit outside `/api/v1` and need no token.
- **Frontend guide:** [frontend/docs/COMPONENTS.md](../../frontend/docs/COMPONENTS.md) covers the screens that call these endpoints.
- **Accuracy:** checked against the code on 2026-11-02.

## Contents

1. [Endpoint summary](#endpoint-summary)
2. [How a request is handled](#how-a-request-is-handled)
3. [Conventions](#conventions)
4. [Health](#health)
5. [Auth](#auth)
6. [Books](#books)
7. [Tickets](#tickets)
8. [Notifications](#notifications)
9. [Admin](#admin)
10. [Data shapes](#data-shapes)
11. [Ticket lifecycle](#ticket-lifecycle)
12. [Configuration](#configuration)

## Endpoint summary

"Any" means any signed-in user. Where both roles can call an endpoint, the backend limits what each one sees.

| Method and path | Access | Role of the endpoint | Called from (frontend) |
| --- | --- | --- | --- |
| `GET /health` | Public | Reports whether the API and database are up | Not called; used by the Docker healthcheck |
| `POST /auth/login` | Public | Exchanges email and password for a JWT | `LoginPage` |
| `GET /auth/me` | Any | Restores the session from a stored token | `AuthProvider` |
| `GET /books` | Any | Lists books: an author's own, or all for an admin | `MyBooksPage`, `AuthorDashboardPage`, `RequesterContext` |
| `GET /books/:bookId` | Any | Gets one book | `RequesterContext` |
| `POST /tickets` | Author | Raises a support query | `NewTicketPage` |
| `GET /tickets` | Any | Lists tickets: an author's own, or the admin queue | `MyTicketsPage`, `AuthorDashboardPage`, `TicketQueuePage`, `AuthorDetailPage` |
| `GET /tickets/:ticketId` | Any | Gets one ticket, shaped for the caller's role | `AuthorTicketDetailPage`, `AdminTicketDetailPage` |
| `PATCH /tickets/:ticketId` | Admin | Changes status, category, priority or assignee | `ManagementPanel` |
| `POST /tickets/:ticketId/responses` | Admin | Sends a support reply the author can see | `ReplyComposer` |
| `POST /tickets/:ticketId/replies` | Author | Sends an author follow-up on their own ticket | `TicketReplyForm` |
| `POST /tickets/:ticketId/notes` | Admin | Adds an internal note | `InternalNoteForm` |
| `POST /tickets/:ticketId/ai-draft` | Admin | Gets, regenerates or revises the AI reply draft | `ReplyComposer` |
| `GET /notifications` | Author | Lists the author's notifications and unread count | `Layout` (toasts), `AuthorTicketDetailPage` |
| `POST /notifications/read` | Author | Marks notifications as read | `AuthorTicketDetailPage` |
| `GET /admin/users` | Admin | Lists admins for assignee pickers | `QueueFilters`, `ManagementPanel` |
| `GET /admin/authors` | Admin | Lists and searches authors with totals | `AuthorsPage` |
| `GET /admin/authors/:authorId` | Admin | Gets one author's profile, totals and books | `AuthorDetailPage` |
| `GET /admin/stats` | Admin | Returns the queue's counters | `StatsStrip` |
| `GET /admin/ai-usage` | Admin | Reports AI calls, tokens and estimated cost | Not called; for operators, via the API or Swagger UI |

## How a request is handled

```
Express app (src/app.ts): helmet, CORS, JSON body (100 KB limit), request logging
  -> Router (src/routes/index.ts): auth, role check, rate limit, Zod validation
    -> Controller (src/controllers): translates HTTP to a service call
      -> Service (src/services): business rules and permissions
        -> Repository (src/repositories): all MongoDB access
      -> Mapper (src/mappers): builds the response shape
  -> Error handler (src/middleware/error-handler.ts): every failure becomes the standard error shape
```

`src/routes/index.ts` holds the whole route table, so it is the place to review auth, roles and validation for any endpoint.

Ticket classification does not run inside the request. `POST /tickets` adds the ticket to an in-memory queue (`src/jobs/classification-queue.ts`, two jobs at a time). On startup, any ticket still marked `pending` is queued again, so a restart doesn't strand it.

## Conventions

### Authentication

Send `Authorization: Bearer <token>` on every request except `GET /health` and `POST /auth/login`.

- Tokens are HS256 JWTs with `sub` (user id), `role` and, for authors, `authorId`. They last 8 hours by default (`JWT_EXPIRES_IN`).
- Each request is authorised from the token alone, with no database lookup. A role change or deleted account therefore takes effect on other endpoints only when the token expires. `GET /auth/me` is the exception, because it does read the user.
- There are no refresh tokens or token revocation.
- The token check runs before route matching for everything after `/auth/login`, so an unknown `/api/v1/...` path returns 401 without a token and 404 with one.

To try it locally, sign in with a seeded account from the [README](../README.md#seed-logins) and pass the token on:

```bash
curl -X POST http://localhost:4000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"priya.sharma@email.com","password":"Author@123"}'

curl http://localhost:4000/api/v1/books \
  -H 'Authorization: Bearer <token>'
```

### Roles and resource visibility

| Situation | Result |
| --- | --- |
| No token, or an invalid or expired one | 401 `UNAUTHENTICATED` |
| Wrong role for the endpoint | 403 `FORBIDDEN` |
| An author asks for another author's ticket or book | 404 `NOT_FOUND`, so its existence doesn't leak |
| A malformed `ticketId` | 404 `NOT_FOUND`, not a validation error |

### Identifiers

| Field | Format | Example | Used for |
| --- | --- | --- | --- |
| `id` | 24-character hex ObjectId | `6541f0c2a1b2c3d4e5f60718` | Tickets, users and notifications in URLs and bodies |
| `bookId` | Business key | `BK001` | `GET /books/:bookId` and the ticket's `bookId` |
| `authorId` | Business key | `AUTH001` | `?authorId=` and `GET /admin/authors/:authorId` |
| `ticketNumber` | Display number | `TKT-0007` | Display and `q` search, never in URLs |

### Response format

```jsonc
// One resource
{ "data": { } }

// Paginated list
{ "data": [], "meta": { "page": 1, "limit": 20, "total": 57 } }
```

`GET /books` and `GET /admin/users` return `{ "data": [] }` with no `meta`, because they aren't paginated. `GET /health` returns its status with no `data` wrapper.

Timestamps are ISO-8601 UTC. `publicationDate`, `lastRoyaltyPayoutDate` and `joinedDate` are date-only (`YYYY-MM-DD`).

### Pagination

`page` starts at 1 and defaults to 1. `limit` defaults to 20 and can be at most 100. Values outside those limits return 400.

### Errors

Every error has this shape. `details` appears only when there are field-level problems.

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": [{ "field": "subject", "message": "Must be at least 3 characters" }]
  }
}
```

| Code | HTTP | Typical cause |
| --- | --- | --- |
| `VALIDATION_ERROR` | 400 | Failed validation, malformed JSON, or a body over 100 KB. Errors that aren't tied to one field use `(root)` as the `field` |
| `UNAUTHENTICATED` | 401 | Missing, invalid or expired token, or wrong login details |
| `FORBIDDEN` | 403 | Wrong role, or an admin account outside `@bookleaf.com` |
| `NOT_FOUND` | 404 | Unknown resource or route, or another author's resource |
| `CONFLICT` | 409 | Reply on a finished or full ticket, or a duplicate unique value |
| `RATE_LIMITED` | 429 | Too many new tickets or replies |
| `INTERNAL_ERROR` | 500 | Unexpected failure. Production hides the original message |
| `AI_UNAVAILABLE` | 503 | No AI draft could be produced |

The per-endpoint error tables below list only the cases specific to that endpoint. The 401 for a bad token applies to every protected route, and the 403 for a wrong role applies to every role-restricted one.

### Rate limits

| Endpoint | Limit (default) | Counted per | Settings |
| --- | --- | --- | --- |
| `POST /tickets` | 5 per hour | User | `TICKET_RATE_LIMIT_MAX`, `TICKET_RATE_LIMIT_WINDOW_MS` |
| `POST /tickets/:ticketId/replies` | 20 per 15 minutes | User | `REPLY_RATE_LIMIT_MAX`, `REPLY_RATE_LIMIT_WINDOW_MS` |

Limits are checked before validation. Rejected requests don't count against the ticket limit, but they do count against the reply limit. Responses carry the standard `RateLimit` headers (draft 8), and a 429 also carries `Retry-After`. Each window starts at the user's first counted request and is fixed, so a full allowance just before a reset can be followed by another just after. Counters are held in memory, so they reset on restart and aren't shared between instances. `POST /auth/login` has no rate limit.

### CORS

Only origins listed in `CORS_ORIGIN` are allowed, with the methods `GET`, `POST`, `PATCH` and `OPTIONS` and the headers `Content-Type` and `Authorization`.

## Health

### `GET /health`

Reports whether the API is running and connected to MongoDB. The Docker healthcheck uses it.

**Access:** public.

| Status | Body | Meaning |
| --- | --- | --- |
| 200 | `{ "status": "ok" }` | The database is connected |
| 503 | `{ "status": "degraded" }` | The API is running but the database isn't connected |

## Auth

### `POST /auth/login`

Checks an email and password and returns a JWT with the user.

**Access:** public.

| Body field | Type | Rules |
| --- | --- | --- |
| `email` | string | Required, valid email. Trimmed and lowercased |
| `password` | string | Required, 1-200 characters |

**Response 200**

```json
{
  "data": {
    "token": "<jwt>",
    "user": {
      "id": "6541f0c2a1b2c3d4e5f60718",
      "email": "priya.sharma@email.com",
      "name": "Priya Sharma",
      "role": "author",
      "authorId": "AUTH001"
    }
  }
}
```

| Error | When |
| --- | --- |
| 400 `VALIDATION_ERROR` | Invalid email or missing password |
| 401 `UNAUTHENTICATED` | Unknown email or wrong password. Both return the same message and take similar time, so accounts can't be discovered |
| 403 `FORBIDDEN` | Correct password, but an admin account's email isn't `@bookleaf.com` |

The API doesn't take a role at login. The role picker on the login page is checked in the browser.

### `GET /auth/me`

Returns the signed-in user. The frontend calls it on load to check a stored token.

**Access:** any signed-in user.

**Response 200:** `{ "data": User }`.

| Error | When |
| --- | --- |
| 401 `UNAUTHENTICATED` | The account no longer exists |

## Books

Books are read-only through the API. They come from the seed script.

### `GET /books`

**Access:** any signed-in user.

- **Author:** always their own books. Any `authorId` is ignored.
- **Admin:** all books, or one author's with `authorId`.

| Query | Type | Rules |
| --- | --- | --- |
| `authorId` | string | Optional, 1-32 characters, e.g. `AUTH001` |

**Response 200:** `{ "data": Book[] }`, sorted by `bookId`, not paginated.

### `GET /books/:bookId`

**Access:** any signed-in user. Authors can only get their own books.

**Response 200:** `{ "data": Book }`.

| Error | When |
| --- | --- |
| 404 `NOT_FOUND` | No such book, or it belongs to another author |

## Tickets

The same paths serve both roles. Authors receive [`AuthorTicket`](#authorticket), and admins receive [`AdminTicket`](#adminticket). The author view is built from an allow-list and never includes internal notes, AI fields, drafts or the assignee.

### `POST /tickets`

Raises a new support query. It responds immediately, and AI classification runs afterwards in the background, so an AI outage can't block or fail ticket creation.

**Access:** author.

| Body field | Type | Rules |
| --- | --- | --- |
| `queryType` | string | Required: `General` or `Account Level` |
| `subject` | string | Required, 3-150 characters after trimming |
| `description` | string | Required, 10-5000 characters after trimming |
| `bookId` | string or null | Optional. Must be one of the author's own books |
| `attachments` | array | Optional, up to 5 items of `{ name, size }` |
| `attachments[].name` | string | 1-255 characters |
| `attachments[].size` | integer | Bytes, up to 10 MB |

Attachments are metadata only. No file is uploaded or stored.

**Request**

```json
{
  "queryType": "General",
  "bookId": "BK001",
  "subject": "Royalty for October not received",
  "description": "My October royalty payment has not reached my account.",
  "attachments": [{ "name": "statement.pdf", "size": 48210 }]
}
```

**Response 201:** `{ "data": AuthorTicket }`.

**What it changes:** creates the ticket as `Open`, with `aiStatus: "pending"` and the placeholders `General Inquiry` and `Medium`, then queues classification. See [classification](#classification).

| Error | When |
| --- | --- |
| 400 `VALIDATION_ERROR` | Invalid fields. An unknown or unowned `bookId` gets "Select one of your own books" on the `bookId` field |
| 403 `FORBIDDEN` | The caller isn't an author, or their token has no `authorId` |
| 429 `RATE_LIMITED` | The author has reached the ticket limit (5 an hour by default). The form shows the message and keeps their text |

### `GET /tickets`

Lists tickets.

**Access:** any signed-in user.

- **Author:** their own tickets, most recently changed first. Only `page`, `limit` and `updatedSince` have any effect. The other parameters are still validated, but ignored.
- **Admin:** all tickets, with every filter below.

| Query | Type | Meaning |
| --- | --- | --- |
| `page`, `limit` | integer | See [pagination](#pagination) |
| `status` | TicketStatus | Exact match |
| `category` | TicketCategory | Exact match on the effective category |
| `priority` | TicketPriority | Exact match on the effective priority |
| `assignedTo` | string | `me`, `unassigned`, or a user id |
| `authorId` | string | One author's tickets, e.g. `AUTH001` |
| `from` | date | Created at or after this `YYYY-MM-DD` date or timestamp |
| `to` | date | Created before this timestamp. A bare `YYYY-MM-DD` includes that whole UTC day |
| `q` | string | Up to 200 characters. Case-insensitive text in the subject, or a ticket number such as `TKT-0007` or `7` |
| `needsReply` | `true` or `false` | Whether an author follow-up is waiting |
| `sort` | string | `urgency` (default), `newest` or `oldest` |
| `updatedSince` | date | Only tickets changed after this time |

`sort=urgency` puts unresolved tickets first, then orders by priority (Critical to Low), then oldest first.

`updatedSince` compares against what the caller can see: `updatedAt` for admins and the author-visible change time for authors. See [`updatedAt`](#what-updatedat-means).

**Response 200:** `{ "data": Ticket[], "meta": { "page", "limit", "total" } }`.

| Error | When |
| --- | --- |
| 400 `VALIDATION_ERROR` | An invalid enum, date, id or page value |

### `GET /tickets/:ticketId`

Gets one ticket. The frontend polls it to show new activity.

**Access:** any signed-in user. Authors can only get their own tickets.

**Response 200:** `{ "data": AuthorTicket }` for authors, `{ "data": AdminTicket }` for admins.

| Error | When |
| --- | --- |
| 404 `NOT_FOUND` | No such ticket, a malformed id, or another author's ticket |

### `PATCH /tickets/:ticketId`

Updates a ticket's status, triage values or assignee. Send at least one field.

**Access:** admin.

| Body field | Type | Effect |
| --- | --- | --- |
| `status` | TicketStatus | Sets the status |
| `category` | TicketCategory or null | A value overrides the AI. `null` resets to the AI value |
| `priority` | TicketPriority or null | A value overrides the AI. `null` resets to the AI value |
| `assignedTo` | string or null | An admin's user id, `me`, or `null` to unassign |

```json
{ "status": "In Progress", "priority": "High", "assignedTo": "me" }
```

**Response 200:** `{ "data": AdminTicket }`.

**What it changes:**

| Change | Effect |
| --- | --- |
| Status to `Resolved` or `Closed` | Sets `resolvedAt` if it isn't already set, and clears `needsReply` |
| Status back to `Open` or `In Progress` | Clears `resolvedAt`. Admins can reopen a ticket this way |
| Status actually differs from the current one | Creates a `status_change` notification and updates the author-visible time |
| Category or priority set to a value | Sets the matching `...Overridden` flag. Later classification won't replace it |
| Category or priority set to `null` | Clears the flag and restores the AI or rules value, or the placeholder if classification is still pending |

Category, priority and assignee changes don't notify the author.

| Error | When |
| --- | --- |
| 400 `VALIDATION_ERROR` | Empty body, an invalid value, or an `assignedTo` that isn't an admin |
| 404 `NOT_FOUND` | No such ticket |

### `POST /tickets/:ticketId/responses`

Sends a support reply the author can see. The reply and any status change are saved in one atomic update.

**Access:** admin.

| Body field | Type | Rules |
| --- | --- | --- |
| `message` | string | Required, 1-5000 characters after trimming |
| `usedAiDraft` | boolean | Optional, default `false`. Records whether the reply started from an AI draft |
| `status` | TicketStatus | Optional. The status to set with the reply |

**Response 201:** `{ "data": AdminTicket }`.

**What it changes:**

- **Status:** uses `status` if sent. Otherwise `Open` moves to `In Progress`, and any other status stays as it is. Replying to a `Resolved` or `Closed` ticket is allowed and doesn't reopen it.
- **Follow-up flag and draft:** clears `needsReply` and the cached AI draft.
- **Notification:** creates one `reply` notification, even when the status also changes. Its `status` field is set only if the status changed.

Authors always see the sender as "BookLeaf Support". Admins see the real admin's name.

| Error | When |
| --- | --- |
| 400 `VALIDATION_ERROR` | Empty or overlong message, or an invalid status |
| 404 `NOT_FOUND` | No such ticket |

### `POST /tickets/:ticketId/replies`

Lets an author follow up on their own ticket while it is still unresolved.

**Access:** author, own tickets only, rate limited per user.

| Body field | Type | Rules |
| --- | --- | --- |
| `message` | string | Required, 1-5000 characters after trimming |

**Response 201:** `{ "data": AuthorTicket }`.

**What it changes:** the status stays the same. `needsReply` becomes `true`, so the ticket stands out in the admin queue, and the cached AI draft is cleared because it predates this message. No notification is created.

| Error | When |
| --- | --- |
| 400 `VALIDATION_ERROR` | Empty or overlong message |
| 404 `NOT_FOUND` | No such ticket, or another author's ticket |
| 409 `CONFLICT` | The ticket is `Resolved` or `Closed`, or the thread already has 50 messages. The author should raise a new ticket |
| 429 `RATE_LIMITED` | Too many replies from this user |

The status and thread-size checks are part of the database update itself, so a reply can't slip in while an admin is resolving the ticket.

### `POST /tickets/:ticketId/notes`

Adds a note for the support team. Authors never see notes, and they are never sent to the AI.

**Access:** admin.

| Body field | Type | Rules |
| --- | --- | --- |
| `text` | string | Required, 1-2000 characters after trimming |

**Response 201:** `{ "data": AdminTicket }`.

**What it changes:** appends the note and updates the admin `updatedAt`. It creates no notification, and the author-visible time doesn't move.

| Error | When |
| --- | --- |
| 400 `VALIDATION_ERROR` | Empty or overlong text |
| 404 `NOT_FOUND` | No such ticket |

### `POST /tickets/:ticketId/ai-draft`

Gets a suggested reply for an admin to review. Nothing is sent to the author. The endpoint is a POST because it can generate and store a draft, but with no options it returns the cached draft at no cost.

**Access:** admin. The body is optional.

| Body field | Type | Rules |
| --- | --- | --- |
| `regenerate` | boolean | Optional, default `false`. Ignores the cached draft |
| `revision.previousDraft` | string | Required with `revision`, 1-5000 characters. The current reply text |
| `revision.suggestions` | string | Required with `revision`, 1-1000 characters. What to change |

**Response 200:** `{ "data": AiDraft }`.

```json
{
  "data": {
    "text": "Dear Priya, thank you for reaching out...",
    "generatedAt": "2026-11-01T10:15:00.000Z",
    "model": "gemini-3.8-flash",
    "fallback": false,
    "warnings": ["Amount ₹5,000 is not in the book record"]
  }
}
```

The `warnings` wording above is illustrative. The list holds automated checks for amounts or dates not found in the record, and for unfilled `[confirm: ...]` placeholders. It may be empty.

**Which draft you get:**

| Request | Model succeeds | Model unavailable |
| --- | --- | --- |
| No options, cached draft exists | Returns the cached draft; no model call | Same; no model call |
| No options, no cached draft | Generates and caches | 200 template draft, not cached |
| `regenerate: true` | Generates and replaces the cache | 200 template draft; cache unchanged |
| `revision` | Rewrites the text and replaces the cache | **503** `AI_UNAVAILABLE`, so the admin's text isn't overwritten |

A template draft has `fallback: true` and `model: "template"`. Because it isn't cached, the next request tries the model again. "Unavailable" covers a missing API key, an outage, rate limiting, an open circuit breaker, and blocked or invalid output.

The model receives only the ticket, the author's first name, the linked book's facts, and the last 3 messages. Internal notes are never loaded.

| Error | When |
| --- | --- |
| 400 `VALIDATION_ERROR` | Invalid body |
| 404 `NOT_FOUND` | No such ticket |
| 503 `AI_UNAVAILABLE` | A revision failed, or even the template couldn't be built. The admin can still reply by hand |

## Notifications

Notifications are in-app only, and only authors receive them. Exactly two events create one: an admin reply and a status change through `PATCH`.

### `GET /notifications`

**Access:** author.

| Query | Type | Rules |
| --- | --- | --- |
| `page`, `limit` | integer | See [pagination](#pagination) |

**Response 200**, newest first:

```json
{
  "data": [
    {
      "id": "6541f0c2a1b2c3d4e5f60719",
      "type": "reply",
      "ticketId": "6541f0c2a1b2c3d4e5f60718",
      "ticketNumber": "TKT-0007",
      "subject": "Royalty for October not received",
      "status": "Resolved",
      "message": "BookLeaf Support replied and marked your query Resolved",
      "read": false,
      "createdAt": "2026-11-01T10:15:00.000Z"
    }
  ],
  "meta": { "page": 1, "limit": 20, "total": 1, "unreadCount": 1 }
}
```

`unreadCount` covers all of the author's notifications, not just the current page.

### `POST /notifications/read`

Marks the caller's unread notifications as read. It can only affect their own.

**Access:** author.

| Body field | Type | Rules |
| --- | --- | --- |
| `ticketId` | string | Optional, 24-character hex id. Omit it to mark everything as read |

**Response 200:** `{ "data": { "updated": 2 } }`, the number of notifications changed.

| Error | When |
| --- | --- |
| 400 `VALIDATION_ERROR` | A malformed `ticketId` |

## Admin

### `GET /admin/users`

Lists admins for assignee pickers, sorted by name.

**Access:** admin.

**Response 200:** `{ "data": [{ "id", "name", "email" }] }`.

### `GET /admin/authors`

Lists authors alphabetically with book, royalty and ticket totals.

**Access:** admin.

| Query | Type | Meaning |
| --- | --- | --- |
| `q` | string | Up to 200 characters. Case-insensitive match on name, email, author id or city |
| `page`, `limit` | integer | See [pagination](#pagination) |

**Response 200:** `{ "data": AuthorSummary[], "meta": { "page", "limit", "total" } }`.

### `GET /admin/authors/:authorId`

Gets one author with their books. For their tickets, call `GET /tickets?authorId=`.

**Access:** admin.

**Response 200:** `{ "data": AuthorSummary & { "books": Book[] } }`.

| Error | When |
| --- | --- |
| 404 `NOT_FOUND` | No such author |

### `GET /admin/stats`

Returns the counters shown above the queue.

**Access:** admin.

```json
{
  "data": {
    "open": 12,
    "inProgress": 5,
    "resolved": 30,
    "closed": 8,
    "critical": 2,
    "unassigned": 7,
    "oldestOpenAt": "2026-10-28T09:00:00.000Z"
  }
}
```

`critical`, `unassigned` and `oldestOpenAt` consider only unresolved tickets (`Open` and `In Progress`). `oldestOpenAt` is `null` if there are none.

### `GET /admin/ai-usage`

Reports AI usage and estimated cost from the AI call log. There is no screen for it in the frontend.

**Access:** admin.

| Query | Type | Rules |
| --- | --- | --- |
| `days` | integer | 1-365, default 30 |

**Response 200**

```json
{
  "data": {
    "since": "2026-10-02T10:15:00.000Z",
    "aiEnabled": true,
    "pricesAsOf": "<date of the price table>",
    "totals": {
      "calls": 42,
      "failures": 1,
      "inputTokens": 58000,
      "outputTokens": 9000,
      "cacheReadTokens": 0,
      "estimatedCostUsd": 0.12
    },
    "byKind": [
      {
        "kind": "classify",
        "model": "gemini-3.5-flash-lite",
        "calls": 30,
        "failures": 1,
        "inputTokens": 40000,
        "outputTokens": 3000,
        "cacheReadTokens": 0,
        "estimatedCostUsd": 0.02,
        "avgLatencyMs": 820,
        "avgInputTokens": 1333,
        "avgOutputTokens": 100
      }
    ]
  }
}
```

The numbers above are illustrative. Costs are estimates from the dated price table in `src/ai/pricing.ts`. Calls that never reached a model because no API key is set aren't logged.

## Data shapes

The TypeScript definitions are in `src/mappers/`, and the frontend mirrors them in `frontend/src/api/types.ts`.

### Enums

| Enum | Values |
| --- | --- |
| Role | `author`, `admin` |
| TicketStatus | `Open`, `In Progress`, `Resolved`, `Closed` |
| TicketPriority | `Critical`, `High`, `Medium`, `Low` |
| TicketCategory | `Royalty & Payments`, `ISBN & Metadata Issues`, `Printing & Quality`, `Distribution & Availability`, `Book Status & Production Updates`, `General Inquiry` |
| QueryType | `General`, `Account Level` |
| AiStatus | `pending`, `done`, `failed` |
| NotificationType | `reply`, `status_change` |

### User

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | |
| `email` | string | |
| `name` | string | |
| `role` | Role | |
| `authorId` | string | Authors only; omitted for admins |

### Book

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | Database id |
| `bookId` | string | Business key, e.g. `BK001` |
| `title`, `isbn`, `genre` | string | |
| `publicationDate` | string or null | `YYYY-MM-DD`. Null before publication |
| `status` | string | Free text, e.g. `Published & Live` or `In Production - Cover Design` |
| `isInProduction` | boolean | True when `status` starts with `In Production` |
| `mrp`, `authorRoyaltyPerCopy` | number or null | Null before publication |
| `totalCopiesSold` | number | |
| `totalRoyaltyEarned`, `royaltyPaid`, `royaltyPending` | number | Zero before publication |
| `lastRoyaltyPayoutDate` | string or null | `YYYY-MM-DD` |
| `printPartner` | string or null | |
| `availableOn` | string[] | Sales platforms |
| `authorId` | string | Business key of the owner |

### AuthorTicket

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | |
| `ticketNumber` | string | e.g. `TKT-0007` |
| `subject`, `description` | string | |
| `status` | TicketStatus | |
| `bookId`, `bookTitle` | string or null | Null for queries not linked to a book |
| `queryType` | QueryType or null | Null on tickets raised before the field existed |
| `attachments` | `{ name, size }[]` | Metadata only |
| `responses` | `{ id, from, message, authorName, createdAt }[]` | `from` is `author` or `support`. Support replies are signed "BookLeaf Support" |
| `createdAt` | string | |
| `updatedAt` | string | The last change the author can see |
| `resolvedAt` | string or null | |

### AdminTicket

Everything in `AuthorTicket`, with these additions and differences:

| Field | Type | Notes |
| --- | --- | --- |
| `updatedAt` | string | The last activity of any kind |
| `authorId`, `authorName`, `authorEmail` | string | |
| `category`, `priority` | enums | The effective values: AI or rules unless overridden |
| `aiCategory`, `aiPriority` | enums or null | What classification suggested |
| `aiReasoning` | string or null | The explanation, or a note that rules were used |
| `aiConfidence` | number or null | 0 to 1. Null when rules were used |
| `aiStatus` | AiStatus | |
| `categoryOverridden`, `priorityOverridden` | boolean | |
| `assignedTo` | `{ id, name }` or null | |
| `internalNotes` | `{ id, text, authorName, createdAt }[]` | `authorName` here is the admin who wrote the note |
| `aiDraft` | AiDraft or null | The cached draft |
| `needsReply` | boolean | An author follow-up is waiting |
| `responses` | as above, plus `usedAiDraft` | Support replies show the real admin's name |

### AiDraft

| Field | Type | Notes |
| --- | --- | --- |
| `text` | string | Plain-text suggested reply |
| `generatedAt` | string | |
| `model` | string | The model name, or `template` |
| `fallback` | boolean | True for a template draft |
| `warnings` | string[] | Things to check before sending. May be empty |

### AuthorSummary

| Field | Type | Notes |
| --- | --- | --- |
| `id`, `authorId`, `name`, `email` | string | |
| `phone`, `city`, `joinedDate` | string or null | `joinedDate` is `YYYY-MM-DD` |
| `totals.books`, `totals.published`, `totals.inProduction` | number | Book counts |
| `totals.copiesSold` | number | Across all books |
| `totals.royaltyEarned`, `totals.royaltyPaid`, `totals.royaltyPending` | number | Across all books |
| `totals.tickets`, `totals.unresolvedTickets` | number | Unresolved means `Open` or `In Progress` |

## Ticket lifecycle

### Status

```
                 first admin reply
   Open ------------------------------> In Progress
    |                                       |
    |   admin PATCH or reply with a status  |
    +----------------> Resolved / Closed <--+
                             |
                             | admin PATCH only (reopen)
                             v
                     Open / In Progress
```

Authors can't change status. For authors, `Resolved` and `Closed` are final: replies return 409, and they raise a new ticket instead.

### Classification

1. `POST /tickets` stores the ticket with `aiStatus: "pending"` and queues it. Until classification finishes, `General Inquiry` and `Medium` are only placeholders, and the UI shows "Classifying…".
2. The background job calls the AI classifier, which falls back to keyword rules if the model fails.
3. The result is saved in one atomic update:
   - **Model result:** `aiStatus: "done"`, with a confidence value.
   - **Rules result:** `aiStatus: "failed"`, with no confidence and a reasoning that says rules were used. The ticket remains fully usable.
   - **Admin override already saved:** the suggestion is stored in `aiCategory` or `aiPriority`, but the override stays in effect.

### What `updatedAt` means

The value depends on who is asking, so authors aren't shown activity they can't see.

| Event | Admin `updatedAt` | Author `updatedAt` |
| --- | --- | --- |
| Ticket created | Changes | Changes |
| Support reply or author follow-up | Changes | Changes |
| Status actually changes | Changes | Changes |
| Internal note | Changes | No change |
| Category, priority or assignee change | Changes | No change |
| Classification finishes | Changes | No change |
| AI draft cached | No change | No change |

## Configuration

Configuration comes from environment variables and is validated at startup. The process won't start if a required value is missing or invalid. See `src/config/env.ts` and `.env.example`.

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `MONGODB_URI` | Yes | | `mongodb://` or `mongodb+srv://` connection string |
| `JWT_SECRET` | Yes | | Token signing secret, at least 32 characters |
| `MONGODB_DB_NAME` | | `bookleaf` | Database name |
| `JWT_EXPIRES_IN` | | `8h` | Token lifetime |
| `NODE_ENV` | | `development` | `production` gives JSON logs and hides internal error messages |
| `PORT` | | `4000` | |
| `LOG_LEVEL` | | `info` | |
| `CORS_ORIGIN` | | `http://localhost:5173` | Comma-separated list of allowed origins |
| `TICKET_RATE_LIMIT_MAX`, `TICKET_RATE_LIMIT_WINDOW_MS` | | `5`, `3600000` | New ticket limit per user; only created tickets count |
| `REPLY_RATE_LIMIT_MAX`, `REPLY_RATE_LIMIT_WINDOW_MS` | | `20`, `900000` | Author reply limit per user |
| `GEMINI_API_KEY` | | | Without it, tickets are classified by rules and drafts use the template |
| `AI_CLASSIFY_MODEL` | | `gemini-3.5-flash-lite` | |
| `AI_DRAFT_MODEL` | | `gemini-3.8-flash` | |
| `AI_TIMEOUT_MS`, `AI_MAX_RETRIES` | | `15000`, `2` | Per-attempt timeout and retry count |
