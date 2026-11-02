import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ProviderError } from '../../src/ai/index.js';
import { loadConfig } from '../../src/config/env.js';
import { AiCallLogModel } from '../../src/models/ai-call-log.model.js';
import { TicketModel } from '../../src/models/ticket.model.js';
import {
  bearer,
  buildContext,
  classificationResult,
  connectTestDb,
  disconnectTestDb,
  DRAFT_TEXT,
  fakeUsage,
  FakeProvider,
  login,
  resetData,
  type TestContext,
} from './helpers.js';

let ctx: Omit<TestContext, 'ids'>;
let provider: FakeProvider;
let ids: TestContext['ids'];
let authorToken: string;
let otherAuthorToken: string;
let adminToken: string;

const AUTHOR_TICKET_KEYS = [
  'attachments',
  'bookId',
  'bookTitle',
  'queryType',
  'createdAt',
  'description',
  'id',
  'resolvedAt',
  'responses',
  'status',
  'subject',
  'ticketNumber',
  'updatedAt',
].sort();

beforeAll(async () => {
  await connectTestDb();
  provider = new FakeProvider();
  ctx = buildContext(provider);
});

beforeEach(async () => {
  ids = await resetData();
  provider.onJson = new FakeProvider().onJson;
  provider.onText = new FakeProvider().onText;
  provider.jsonCalls = 0;
  provider.textCalls = 0;
  authorToken = await login(ctx.app, 'priya@test.com');
  otherAuthorToken = await login(ctx.app, 'sneha@test.com');
  adminToken = await login(ctx.app, 'admin@bookleaf.com');
});

afterAll(disconnectTestDb);

const idle = () => ctx.container.classificationQueue.onIdle();

async function createTicket(
  overrides: Partial<{ subject: string; description: string; bookId: string | null }> = {},
  token = authorToken,
) {
  const res = await request(ctx.app)
    .post('/api/v1/tickets')
    .set(bearer(token))
    .send({
      queryType: 'General',
      bookId: 'BK001',
      subject: 'Royalty payment missing',
      description: 'I have not received my royalty payment for last quarter.',
      ...overrides,
    });
  expect(res.status).toBe(201);
  return res.body.data as { id: string; ticketNumber: string; updatedAt: string };
}

describe('POST /tickets', () => {
  it('returns 201 even when the AI provider throws, then stores the rule-based fallback', async () => {
    const res = await request(ctx.app)
      .post('/api/v1/tickets')
      .set(bearer(authorToken))
      .send({
        queryType: 'Account Level',
        bookId: 'BK001',
        subject: 'Amazon shows the wrong ISBN',
        description: 'The ISBN on Amazon is different from the one printed on my book.',
        attachments: [{ name: 'photo.jpg', size: 2048 }],
      });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      ticketNumber: 'TKT-0001',
      status: 'Open',
      bookId: 'BK001',
      bookTitle: 'Whispers of the Ganges',
      queryType: 'Account Level',
      attachments: [{ name: 'photo.jpg', size: 2048 }],
      responses: [],
    });

    await idle();
    expect(provider.jsonCalls).toBeGreaterThan(0);

    const admin = await request(ctx.app).get(`/api/v1/tickets/${res.body.data.id}`).set(bearer(adminToken));
    expect(admin.body.data).toMatchObject({
      aiStatus: 'failed',
      aiConfidence: null,
      category: 'ISBN & Metadata Issues',
      aiCategory: 'ISBN & Metadata Issues',
      categoryOverridden: false,
    });
    expect(admin.body.data.aiReasoning).toMatch(/rule/i);
    expect(['Critical', 'High']).toContain(admin.body.data.priority);

    const log = await AiCallLogModel.findOne({ kind: 'classify' }).lean();
    expect(log).toMatchObject({ success: false, errorCode: 'UNAVAILABLE', model: 'gemini-3.5-flash-lite' });
  });

  it('stores the AI classification and logs token usage and cost when the model answers', async () => {
    provider.onJson = () => classificationResult({ category: 'Royalty & Payments', priority: 'High', confidence: 0.92 });
    const ticket = await createTicket();
    await idle();

    const admin = await request(ctx.app).get(`/api/v1/tickets/${ticket.id}`).set(bearer(adminToken));
    expect(admin.body.data).toMatchObject({
      aiStatus: 'done',
      category: 'Royalty & Payments',
      aiCategory: 'Royalty & Payments',
      aiConfidence: 0.92,
    });
    const log = await AiCallLogModel.findOne({ kind: 'classify' }).lean();
    expect(log).toMatchObject({
      success: true,
      inputTokens: fakeUsage.inputTokens,
      outputTokens: fakeUsage.outputTokens,
      errorCode: null,
    });
    expect(log!.estimatedCostUsd).toBeGreaterThan(0);
  });

  it('numbers tickets sequentially', async () => {
    const first = await createTicket();
    const second = await createTicket({ subject: 'Second question' });
    expect([first.ticketNumber, second.ticketNumber]).toEqual(['TKT-0001', 'TKT-0002']);
  });

  it('rejects invalid input with the VALIDATION_ERROR shape and field details', async () => {
    const res = await request(ctx.app)
      .post('/api/v1/tickets')
      .set(bearer(authorToken))
      .send({ subject: 'Hi', description: 'short' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: expect.arrayContaining([
          { field: 'subject', message: 'Must be at least 3 characters' },
          { field: 'description', message: 'Must be at least 10 characters' },
        ]),
      },
    });
  });

  it('requires queryType to be General or Account Level', async () => {
    for (const queryType of [undefined, '', 'Billing']) {
      const res = await request(ctx.app)
        .post('/api/v1/tickets')
        .set(bearer(authorToken))
        .send({ queryType, subject: 'Question', description: 'A sufficiently long description.' });
      expect(res.status).toBe(400);
      expect(res.body.error.details).toEqual([
        { field: 'queryType', message: 'Must be one of: General, Account Level' },
      ]);
    }
  });

  it("rejects an unknown or another author's bookId on the bookId field, without revealing which", async () => {
    for (const bookId of ['BK999', 'BK011']) {
      const res = await request(ctx.app)
        .post('/api/v1/tickets')
        .set(bearer(authorToken))
        .send({ queryType: 'General', bookId, subject: 'Question', description: 'A sufficiently long description.' });
      expect(res.status).toBe(400);
      expect(res.body.error.details).toEqual([{ field: 'bookId', message: 'Select one of your own books' }]);
    }
  });

  it('defaults to 5 created tickets per hour', () => {
    const config = loadConfig({ MONGODB_URI: 'mongodb://localhost/test', JWT_SECRET: 'x'.repeat(32) });
    expect(config.ticketRateLimit).toEqual({ max: 5, windowMs: 60 * 60 * 1000 });
  });

  it('limits created tickets per author, without counting rejected requests', async () => {
    const limited = buildContext(new FakeProvider(), { TICKET_RATE_LIMIT_MAX: '2' });
    const send = (token: string, subject = 'Royalty payment missing') =>
      request(limited.app)
        .post('/api/v1/tickets')
        .set(bearer(token))
        .send({ queryType: 'General', subject, description: 'I have not received my royalty payment.' });

    expect((await send(authorToken, 'x')).status).toBe(400);
    expect((await send(authorToken)).status).toBe(201);
    expect((await send(authorToken)).status).toBe(201);

    const blocked = await send(authorToken);
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
    expect(blocked.body.error.message).toContain('up to 2 queries every 60 minutes');
    expect(await TicketModel.countDocuments()).toBe(2);

    expect((await send(otherAuthorToken)).status).toBe(201);
    await limited.container.classificationQueue.onIdle();
  });
});

describe('author view and isolation', () => {
  it('never exposes internal notes, AI fields, drafts or the assignee to authors', async () => {
    provider.onJson = () => classificationResult({ category: 'Royalty & Payments', priority: 'High' });
    const ticket = await createTicket();
    await idle();
    const base = `/api/v1/tickets/${ticket.id}`;
    await request(ctx.app).patch(base).set(bearer(adminToken)).send({ assignedTo: 'me' });
    await request(ctx.app).post(`${base}/notes`).set(bearer(adminToken)).send({ text: 'Secret internal note' });
    await request(ctx.app).post(`${base}/ai-draft`).set(bearer(adminToken)).send({});
    await request(ctx.app).post(`${base}/responses`).set(bearer(adminToken)).send({ message: 'We are on it.' });

    const single = await request(ctx.app).get(base).set(bearer(authorToken));
    const list = await request(ctx.app).get('/api/v1/tickets').set(bearer(authorToken));

    for (const payload of [single.body.data, list.body.data[0]]) {
      expect(Object.keys(payload).sort()).toEqual(AUTHOR_TICKET_KEYS);
      expect(payload.responses).toHaveLength(1);
      expect(Object.keys(payload.responses[0]).sort()).toEqual(['authorName', 'createdAt', 'from', 'id', 'message']);
      expect(payload.responses[0].authorName).toBe('BookLeaf Support');
    }
    expect(JSON.stringify(single.body)).not.toMatch(/Secret internal note|aiReasoning|Asha Admin/);
  });

  it("returns 404 when an author reads another author's ticket, and for malformed ids", async () => {
    const ticket = await createTicket();
    const other = await request(ctx.app).get(`/api/v1/tickets/${ticket.id}`).set(bearer(otherAuthorToken));
    expect(other.status).toBe(404);
    expect(other.body.error.code).toBe('NOT_FOUND');

    const list = await request(ctx.app).get('/api/v1/tickets').set(bearer(otherAuthorToken));
    expect(list.body.data).toEqual([]);

    const malformed = await request(ctx.app).get('/api/v1/tickets/not-an-id').set(bearer(adminToken));
    expect(malformed.status).toBe(404);
  });
});

describe('admin workflow', () => {
  it('sorts by urgency: unresolved first, then Critical > High > Medium > Low, then oldest first', async () => {
    const make = async (subject: string, priority: string, status = 'Open') => {
      const t = await createTicket({ subject });
      await request(ctx.app).patch(`/api/v1/tickets/${t.id}`).set(bearer(adminToken)).send({ priority, status });
      return subject;
    };
    await idle();
    await make('Low open', 'Low');
    await make('Critical resolved', 'Critical', 'Resolved');
    await make('High open older', 'High');
    await make('Critical in progress', 'Critical', 'In Progress');
    await make('High open newer', 'High');
    await make('Medium open', 'Medium');
    await idle();

    const res = await request(ctx.app).get('/api/v1/tickets?sort=urgency').set(bearer(adminToken));
    expect(res.body.data.map((t: { subject: string }) => t.subject)).toEqual([
      'Critical in progress',
      'High open older',
      'High open newer',
      'Medium open',
      'Low open',
      'Critical resolved',
    ]);
    expect(res.body.meta).toEqual({ page: 1, limit: 20, total: 6 });
  });

  it('sets override flags on PATCH, keeps overrides when classification lands later, and null resets to AI', async () => {
    provider.onJson = () => classificationResult({ category: 'Royalty & Payments', priority: 'High' });
    const ticket = await createTicket();
    const patched = await request(ctx.app)
      .patch(`/api/v1/tickets/${ticket.id}`)
      .set(bearer(adminToken))
      .send({ category: 'Printing & Quality', priority: 'Low', assignedTo: 'me' });
    expect(patched.status).toBe(200);
    expect(patched.body.data).toMatchObject({
      category: 'Printing & Quality',
      priority: 'Low',
      categoryOverridden: true,
      priorityOverridden: true,
      assignedTo: { id: ids.admin, name: 'Asha Admin' },
    });

    await idle();
    const after = await request(ctx.app).get(`/api/v1/tickets/${ticket.id}`).set(bearer(adminToken));
    expect(after.body.data).toMatchObject({
      aiStatus: 'done',
      aiCategory: 'Royalty & Payments',
      aiPriority: 'High',
      category: 'Printing & Quality',
      priority: 'Low',
    });

    const reset = await request(ctx.app)
      .patch(`/api/v1/tickets/${ticket.id}`)
      .set(bearer(adminToken))
      .send({ category: null, priority: null });
    expect(reset.body.data).toMatchObject({
      category: 'Royalty & Payments',
      priority: 'High',
      categoryOverridden: false,
      priorityOverridden: false,
    });
  });

  it('validates PATCH input: empty body and non-admin assignee', async () => {
    const ticket = await createTicket();
    const empty = await request(ctx.app).patch(`/api/v1/tickets/${ticket.id}`).set(bearer(adminToken)).send({});
    expect(empty.status).toBe(400);

    const author = await request(ctx.app).get('/api/v1/auth/me').set(bearer(authorToken));
    const badAssignee = await request(ctx.app)
      .patch(`/api/v1/tickets/${ticket.id}`)
      .set(bearer(adminToken))
      .send({ assignedTo: author.body.data.id });
    expect(badAssignee.status).toBe(400);
    expect(badAssignee.body.error.details[0].field).toBe('assignedTo');
  });

  it('a response moves Open to In Progress, bumps updatedAt and is visible to the author', async () => {
    const ticket = await createTicket();
    await idle();
    await new Promise((resolve) => setTimeout(resolve, 5));

    const res = await request(ctx.app)
      .post(`/api/v1/tickets/${ticket.id}/responses`)
      .set(bearer(adminToken))
      .send({ message: 'Hi Priya, we are checking with finance.', usedAiDraft: true });

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('In Progress');
    expect(res.body.data.responses[0]).toMatchObject({ authorName: 'Asha Admin', usedAiDraft: true });
    expect(new Date(res.body.data.updatedAt).getTime()).toBeGreaterThan(new Date(ticket.updatedAt).getTime());

    const author = await request(ctx.app).get(`/api/v1/tickets/${ticket.id}`).set(bearer(authorToken));
    expect(author.body.data.status).toBe('In Progress');
    expect(author.body.data.responses[0]).toMatchObject({
      message: 'Hi Priya, we are checking with finance.',
      authorName: 'BookLeaf Support',
    });
  });

  it('a response with status Resolved sets resolvedAt; reopening clears it', async () => {
    const ticket = await createTicket();
    const resolved = await request(ctx.app)
      .post(`/api/v1/tickets/${ticket.id}/responses`)
      .set(bearer(adminToken))
      .send({ message: 'All sorted.', status: 'Resolved' });
    expect(resolved.body.data.status).toBe('Resolved');
    expect(resolved.body.data.resolvedAt).toEqual(expect.any(String));

    const reopened = await request(ctx.app)
      .patch(`/api/v1/tickets/${ticket.id}`)
      .set(bearer(adminToken))
      .send({ status: 'Open' });
    expect(reopened.body.data.resolvedAt).toBeNull();
  });

  it('supports ?updatedSince= polling: notes bump updatedAt and only changed tickets come back', async () => {
    const a = await createTicket({ subject: 'Ticket A' });
    await createTicket({ subject: 'Ticket B' });
    await idle();
    const since = new Date().toISOString();

    const nothing = await request(ctx.app).get(`/api/v1/tickets?updatedSince=${since}`).set(bearer(adminToken));
    expect(nothing.body.data).toEqual([]);

    await new Promise((resolve) => setTimeout(resolve, 5));
    await request(ctx.app).post(`/api/v1/tickets/${a.id}/notes`).set(bearer(adminToken)).send({ text: 'Checked.' });

    const changed = await request(ctx.app).get(`/api/v1/tickets?updatedSince=${since}`).set(bearer(adminToken));
    expect(changed.body.data.map((t: { subject: string }) => t.subject)).toEqual(['Ticket A']);
    expect(changed.body.data[0].internalNotes[0]).toMatchObject({ text: 'Checked.', authorName: 'Asha Admin' });
  });

  describe('author view of updatedAt', () => {
    const tick = () => new Promise((resolve) => setTimeout(resolve, 5));
    const asAuthor = async (id: string) =>
      (await request(ctx.app).get(`/api/v1/tickets/${id}`).set(bearer(authorToken))).body.data;
    const asAdmin = async (id: string) =>
      (await request(ctx.app).get(`/api/v1/tickets/${id}`).set(bearer(adminToken))).body.data;

    it('ignores admin-only changes and classification, while the admin still sees them', async () => {
      const ticket = await createTicket();
      await idle();
      await tick();
      const before = (await asAuthor(ticket.id)).updatedAt;
      expect(before).toBe(ticket.updatedAt);

      await request(ctx.app).post(`/api/v1/tickets/${ticket.id}/notes`).set(bearer(adminToken)).send({ text: 'Checked.' });
      const patched = await request(ctx.app)
        .patch(`/api/v1/tickets/${ticket.id}`)
        .set(bearer(adminToken))
        .send({ assignedTo: 'me', category: 'Royalty & Payments', priority: 'Critical', status: 'Open' });
      expect(patched.status).toBe(200);

      expect((await asAuthor(ticket.id)).updatedAt).toBe(before);
      expect(new Date((await asAdmin(ticket.id)).updatedAt).getTime()).toBeGreaterThan(new Date(before).getTime());
    });

    it('moves when a reply is sent or the status really changes', async () => {
      const ticket = await createTicket();
      await idle();
      await tick();

      await request(ctx.app).post(`/api/v1/tickets/${ticket.id}/responses`).set(bearer(adminToken)).send({ message: 'On it.' });
      const replied = (await asAuthor(ticket.id)).updatedAt;
      expect(new Date(replied).getTime()).toBeGreaterThan(new Date(ticket.updatedAt).getTime());

      await tick();
      await request(ctx.app).patch(`/api/v1/tickets/${ticket.id}`).set(bearer(adminToken)).send({ status: 'Resolved' });
      expect(new Date((await asAuthor(ticket.id)).updatedAt).getTime()).toBeGreaterThan(new Date(replied).getTime());
    });

    it('drives the author list order and updatedSince, not admin activity', async () => {
      const older = await createTicket({ subject: 'Older ticket' });
      await tick();
      await createTicket({ subject: 'Newer ticket' });
      await idle();
      const since = new Date().toISOString();
      await tick();

      await request(ctx.app).post(`/api/v1/tickets/${older.id}/notes`).set(bearer(adminToken)).send({ text: 'Checked.' });

      const list = await request(ctx.app).get('/api/v1/tickets').set(bearer(authorToken));
      expect(list.body.data.map((t: { subject: string }) => t.subject)).toEqual(['Newer ticket', 'Older ticket']);
      const quiet = await request(ctx.app).get(`/api/v1/tickets?updatedSince=${since}`).set(bearer(authorToken));
      expect(quiet.body.data).toEqual([]);

      await request(ctx.app).post(`/api/v1/tickets/${older.id}/responses`).set(bearer(adminToken)).send({ message: 'Done.' });

      const changed = await request(ctx.app).get(`/api/v1/tickets?updatedSince=${since}`).set(bearer(authorToken));
      expect(changed.body.data.map((t: { subject: string }) => t.subject)).toEqual(['Older ticket']);
    });

    it('backfills tickets created before the field existed, without touching updatedAt', async () => {
      const untouched = await createTicket({ subject: 'No reply' });
      const replied = await createTicket({ subject: 'Has reply' });
      await request(ctx.app).post(`/api/v1/tickets/${replied.id}/responses`).set(bearer(adminToken)).send({ message: 'Hello.' });
      await idle();
      await TicketModel.collection.updateMany({}, { $unset: { authorUpdatedAt: '' } });
      const adminBefore = (await asAdmin(replied.id)).updatedAt;

      expect(await ctx.container.ticketRepository.backfillAuthorUpdatedAt()).toBe(2);
      expect(await ctx.container.ticketRepository.backfillAuthorUpdatedAt()).toBe(0);

      const plain = await asAuthor(untouched.id);
      expect(plain.updatedAt).toBe(plain.createdAt);
      const withReply = await asAuthor(replied.id);
      expect(withReply.updatedAt).toBe(withReply.responses[0].createdAt);
      expect((await asAdmin(replied.id)).updatedAt).toBe(adminBefore);
    });
  });

  it('filters by status, assignee and subject search (regex input is matched literally)', async () => {
    const a = await createTicket({ subject: 'Cover (draft) question' });
    await createTicket({ subject: 'Another thing' });
    await request(ctx.app).patch(`/api/v1/tickets/${a.id}`).set(bearer(adminToken)).send({ assignedTo: ids.ops });

    const byAssignee = await request(ctx.app).get(`/api/v1/tickets?assignedTo=${ids.ops}`).set(bearer(adminToken));
    expect(byAssignee.body.data).toHaveLength(1);
    const unassigned = await request(ctx.app).get('/api/v1/tickets?assignedTo=unassigned').set(bearer(adminToken));
    expect(unassigned.body.data.map((t: { subject: string }) => t.subject)).toEqual(['Another thing']);
    const search = await request(ctx.app).get('/api/v1/tickets?q=(draft)').set(bearer(adminToken));
    expect(search.body.data).toHaveLength(1);
    const byNumber = await request(ctx.app).get('/api/v1/tickets?q=TKT-0002').set(bearer(adminToken));
    expect(byNumber.body.data.map((t: { subject: string }) => t.subject)).toEqual(['Another thing']);
    const bad = await request(ctx.app).get('/api/v1/tickets?status=Pending').set(bearer(adminToken));
    expect(bad.status).toBe(400);
  });

  it('reports queue stats', async () => {
    const a = await createTicket();
    await createTicket();
    await request(ctx.app).patch(`/api/v1/tickets/${a.id}`).set(bearer(adminToken)).send({ priority: 'Critical' });

    const res = await request(ctx.app).get('/api/v1/admin/stats').set(bearer(adminToken));
    expect(res.body.data).toMatchObject({ open: 2, inProgress: 0, resolved: 0, closed: 0, critical: 1, unassigned: 2 });
    expect(res.body.data.oldestOpenAt).toEqual(expect.any(String));
  });
});

describe('POST /tickets/:id/ai-draft', () => {
  it('generates a draft once, caches it, and only calls the model again on regenerate', async () => {
    provider.onText = () => ({ text: DRAFT_TEXT, usage: fakeUsage });
    const ticket = await createTicket();
    const url = `/api/v1/tickets/${ticket.id}/ai-draft`;

    const first = await request(ctx.app).post(url).set(bearer(adminToken)).send({});
    expect(first.status).toBe(200);
    expect(first.body.data).toMatchObject({ text: DRAFT_TEXT, model: 'gemini-3.8-flash', fallback: false });
    expect(first.body.data.warnings).toEqual(expect.any(Array));

    await request(ctx.app).post(url).set(bearer(adminToken)).send({});
    expect(provider.textCalls).toBe(1);

    await request(ctx.app).post(url).set(bearer(adminToken)).send({ regenerate: true });
    expect(provider.textCalls).toBe(2);

    const admin = await request(ctx.app).get(`/api/v1/tickets/${ticket.id}`).set(bearer(adminToken));
    expect(admin.body.data.aiDraft.text).toBe(DRAFT_TEXT);
    expect(await AiCallLogModel.countDocuments({ kind: 'draft', success: true })).toBe(2);
  });

  it('serves an uncached template draft (fallback: true) when the model fails, and retries next time', async () => {
    const ticket = await createTicket();
    const url = `/api/v1/tickets/${ticket.id}/ai-draft`;

    const res = await request(ctx.app).post(url).set(bearer(adminToken)).send({});
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ model: 'template', fallback: true });
    expect(res.body.data.text).toContain('[confirm:');
    expect(res.body.data.warnings.length).toBeGreaterThan(0);
    expect(res.body.data.text).toContain('BookLeaf Author Support');

    const stored = await TicketModel.findById(ticket.id).lean();
    expect(stored!.aiDraft).toBeNull();

    const callsBefore = provider.textCalls;
    await request(ctx.app).post(url).set(bearer(adminToken)).send({});
    expect(provider.textCalls).toBeGreaterThan(callsBefore);
    expect(await AiCallLogModel.countDocuments({ kind: 'draft', success: false })).toBe(2);
  });

  it('clears the cached draft when an admin responds', async () => {
    provider.onText = () => ({ text: DRAFT_TEXT, usage: fakeUsage });
    const ticket = await createTicket();
    await request(ctx.app).post(`/api/v1/tickets/${ticket.id}/ai-draft`).set(bearer(adminToken)).send({});
    await request(ctx.app)
      .post(`/api/v1/tickets/${ticket.id}/responses`)
      .set(bearer(adminToken))
      .send({ message: 'Sent.', usedAiDraft: true });
    const stored = await TicketModel.findById(ticket.id).lean();
    expect(stored!.aiDraft).toBeNull();
  });

  it('revises the cached draft with the admin suggestions and replaces it', async () => {
    const prompts: string[] = [];
    provider.onText = (req) => {
      prompts.push(req.prompt);
      return { text: prompts.length === 1 ? DRAFT_TEXT : `${DRAFT_TEXT} Updated.`, usage: fakeUsage };
    };
    const ticket = await createTicket();
    const url = `/api/v1/tickets/${ticket.id}/ai-draft`;
    await request(ctx.app).post(url).set(bearer(adminToken)).send({});

    const res = await request(ctx.app)
      .post(url)
      .set(bearer(adminToken))
      .send({ revision: { previousDraft: 'My edited draft text.', suggestions: 'Sound more apologetic.' } });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ fallback: false });
    expect(res.body.data.text).toContain('Updated.');
    expect(provider.textCalls).toBe(2);
    expect(prompts[1]).toContain('<previous_draft>\nMy edited draft text.\n</previous_draft>');
    expect(prompts[1]).toContain('<admin_suggestions>\nSound more apologetic.\n</admin_suggestions>');

    const stored = await TicketModel.findById(ticket.id).lean();
    expect(stored!.aiDraft!.text).toContain('Updated.');
    expect(await AiCallLogModel.countDocuments({ kind: 'draft', success: true })).toBe(2);
  });

  it('returns 503 instead of the template when a revision fails, and keeps the cached draft', async () => {
    provider.onText = () => ({ text: DRAFT_TEXT, usage: fakeUsage });
    const ticket = await createTicket();
    const url = `/api/v1/tickets/${ticket.id}/ai-draft`;
    await request(ctx.app).post(url).set(bearer(adminToken)).send({});

    provider.onText = () => {
      throw new ProviderError('UNAVAILABLE', 'fake outage', { retryable: true });
    };
    const res = await request(ctx.app)
      .post(url)
      .set(bearer(adminToken))
      .send({ revision: { previousDraft: 'My edited draft text.', suggestions: 'Be brief.' } });

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('AI_UNAVAILABLE');
    const stored = await TicketModel.findById(ticket.id).lean();
    expect(stored!.aiDraft!.text).toBe(DRAFT_TEXT);
    expect(await AiCallLogModel.countDocuments({ kind: 'draft', success: false })).toBe(1);
  });

  it.each([
    ['empty suggestions', { previousDraft: 'Draft.', suggestions: '   ' }, 'revision.suggestions'],
    ['suggestions over 1000 characters', { previousDraft: 'Draft.', suggestions: 'x'.repeat(1001) }, 'revision.suggestions'],
    ['no previous draft', { suggestions: 'Be brief.' }, 'revision.previousDraft'],
    ['a previous draft over 5000 characters', { previousDraft: 'x'.repeat(5001), suggestions: 'Be brief.' }, 'revision.previousDraft'],
  ])('rejects a revision with %s', async (_label, revision, field) => {
    const ticket = await createTicket();
    const callsBefore = provider.textCalls;
    const res = await request(ctx.app)
      .post(`/api/v1/tickets/${ticket.id}/ai-draft`)
      .set(bearer(adminToken))
      .send({ revision });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details[0].field).toBe(field);
    expect(provider.textCalls).toBe(callsBefore);
  });

  it('returns 404 for an unknown ticket', async () => {
    const res = await request(ctx.app)
      .post('/api/v1/tickets/64b7f0c2a1b2c3d4e5f60718/ai-draft')
      .set(bearer(adminToken))
      .send({});
    expect(res.status).toBe(404);
  });
});

describe('crash recovery', () => {
  it('re-queues tickets still pending classification on boot', async () => {
    provider.onJson = () => classificationResult({ category: 'General Inquiry', priority: 'Low' });
    const ticket = await createTicket();
    await idle();
    await TicketModel.updateOne({ _id: ticket.id }, { $set: { aiStatus: 'pending' } });

    const requeued = await ctx.container.classificationQueue.requeue(() =>
      ctx.container.ticketRepository.findPendingClassificationIds(),
    );
    expect(requeued).toBe(1);
    await idle();
    const stored = await TicketModel.findById(ticket.id).lean();
    expect(stored!.aiStatus).toBe('done');
  });
});
