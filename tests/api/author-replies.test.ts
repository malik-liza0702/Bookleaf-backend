import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { NotificationModel } from '../../src/models/notification.model.js';
import { TicketModel } from '../../src/models/ticket.model.js';
import {
  bearer,
  buildContext,
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
let authorToken: string;
let otherAuthorToken: string;
let adminToken: string;

beforeAll(async () => {
  await connectTestDb();
  provider = new FakeProvider();
  ctx = buildContext(provider);
});

beforeEach(async () => {
  await resetData();
  provider.onText = () => {
    throw new Error('not scripted');
  };
  authorToken = await login(ctx.app, 'priya@test.com');
  otherAuthorToken = await login(ctx.app, 'sneha@test.com');
  adminToken = await login(ctx.app, 'admin@bookleaf.com');
});

afterAll(disconnectTestDb);

async function createTicket(app = ctx.app, token = authorToken): Promise<string> {
  const res = await request(app)
    .post('/api/v1/tickets')
    .set(bearer(token))
    .send({
      queryType: 'General',
      subject: 'Royalty payment missing',
      description: 'I have not received my royalty payment for last quarter.',
    });
  expect(res.status).toBe(201);
  await ctx.container.classificationQueue.onIdle();
  return res.body.data.id as string;
}

const authorReply = (ticketId: string, message = 'That did not answer my question.', token = authorToken, app = ctx.app) =>
  request(app).post(`/api/v1/tickets/${ticketId}/replies`).set(bearer(token)).send({ message });

const adminRespond = (ticketId: string, body: Record<string, unknown> = {}) =>
  request(ctx.app)
    .post(`/api/v1/tickets/${ticketId}/responses`)
    .set(bearer(adminToken))
    .send({ message: 'Here is an update.', ...body });

const adminView = async (ticketId: string) =>
  (await request(ctx.app).get(`/api/v1/tickets/${ticketId}`).set(bearer(adminToken))).body.data;

describe('POST /tickets/:id/replies', () => {
  it('adds the message to the thread, labelled by sender, in both views', async () => {
    const id = await createTicket();
    await adminRespond(id);

    const res = await authorReply(id);
    expect(res.status).toBe(201);
    expect(res.body.data.responses.map((r: { from: string; authorName: string }) => [r.from, r.authorName])).toEqual([
      ['support', 'BookLeaf Support'],
      ['author', 'Priya Sharma'],
    ]);
    expect(Object.keys(res.body.data)).not.toContain('needsReply');
    expect(Object.keys(res.body.data.responses[1]).sort()).toEqual(['authorName', 'createdAt', 'from', 'id', 'message']);

    const admin = await adminView(id);
    expect(admin.responses.map((r: { from: string; authorName: string }) => [r.from, r.authorName])).toEqual([
      ['support', 'Asha Admin'],
      ['author', 'Priya Sharma'],
    ]);
    expect(admin.responses[1].usedAiDraft).toBe(false);
  });

  it.each(['Open', 'In Progress'])('leaves a ticket that is %s in the same status', async (status) => {
    const id = await createTicket();
    await request(ctx.app).patch(`/api/v1/tickets/${id}`).set(bearer(adminToken)).send({ status });

    const res = await authorReply(id);
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe(status);
    expect(res.body.data.resolvedAt).toBeNull();
  });

  it.each(['Resolved', 'Closed'])('refuses replies once a ticket is %s, without changing it', async (status) => {
    const id = await createTicket();
    await adminRespond(id, { status });
    const before = await adminView(id);

    const res = await authorReply(id);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');

    const after = await adminView(id);
    expect(after.status).toBe(status);
    expect(after.responses).toHaveLength(1);
    expect(after.needsReply).toBe(false);
    expect(after.resolvedAt).toBe(before.resolvedAt);
  });

  it('moves the author-visible updatedAt and creates no notification for the sender', async () => {
    const id = await createTicket();
    const before = (await TicketModel.findById(id).lean())!.authorUpdatedAt;
    await new Promise((resolve) => setTimeout(resolve, 5));

    const res = await authorReply(id);
    expect(new Date(res.body.data.updatedAt).getTime()).toBeGreaterThan(before.getTime());
    expect(await NotificationModel.countDocuments()).toBe(0);
  });

  it('only accepts the author who owns the ticket', async () => {
    const id = await createTicket();
    expect((await authorReply(id, 'Hello there', otherAuthorToken)).status).toBe(404);
    expect((await authorReply('not-an-id')).status).toBe(404);
    expect((await authorReply(id, 'Hello there', adminToken)).status).toBe(403);
    expect((await request(ctx.app).post(`/api/v1/tickets/${id}/replies`).send({ message: 'Hi' })).status).toBe(401);
    expect((await adminView(id)).responses).toHaveLength(0);
  });

  it('validates the message', async () => {
    const id = await createTicket();
    for (const message of ['   ', 'x'.repeat(5001)]) {
      const res = await authorReply(id, message);
      expect(res.status).toBe(400);
      expect(res.body.error.details[0].field).toBe('message');
    }
  });

  it('refuses replies once the thread is full', async () => {
    const id = await createTicket();
    const admin = (await TicketModel.findById(id).lean())!.authorUser;
    const responses = Array.from({ length: 50 }, () => ({ admin, adminName: 'Asha Admin', message: 'Update' }));
    await TicketModel.updateOne({ _id: id }, { $push: { responses: { $each: responses } } });

    expect((await authorReply(id)).status).toBe(409);
    expect((await adminView(id)).responses).toHaveLength(50);
  });

  it('rate limits per author', async () => {
    const limited = buildContext(new FakeProvider(), { REPLY_RATE_LIMIT_MAX: '2' });
    const id = await createTicket(limited.app);

    expect((await authorReply(id, 'One', authorToken, limited.app)).status).toBe(201);
    expect((await authorReply(id, 'Two', authorToken, limited.app)).status).toBe(201);
    const blocked = await authorReply(id, 'Three', authorToken, limited.app);
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');

    const otherId = await createTicket(limited.app, otherAuthorToken);
    expect((await authorReply(otherId, 'One', otherAuthorToken, limited.app)).status).toBe(201);
  });

  it('labels replies stored before the sender existed as support', async () => {
    const id = await createTicket();
    await adminRespond(id);
    await TicketModel.collection.updateOne({}, { $unset: { 'responses.$[].from': '', needsReply: '' } });

    const res = await request(ctx.app).get(`/api/v1/tickets/${id}`).set(bearer(authorToken));
    expect(res.body.data.responses[0].from).toBe('support');
    const admin = await adminView(id);
    expect(admin.responses[0]).toMatchObject({ from: 'support', authorName: 'Asha Admin' });
    expect(admin.needsReply).toBe(false);
  });
});

describe('needsReply in the admin queue', () => {
  const needingReply = async (query = 'needsReply=true') => {
    const res = await request(ctx.app).get(`/api/v1/tickets?${query}`).set(bearer(adminToken));
    expect(res.status).toBe(200);
    return res.body.data.map((ticket: { id: string }) => ticket.id);
  };

  it('is set by an author reply and cleared by a support reply', async () => {
    const id = await createTicket();
    const untouched = await createTicket();
    expect((await adminView(id)).needsReply).toBe(false);

    await authorReply(id);
    expect((await adminView(id)).needsReply).toBe(true);
    expect(await needingReply()).toEqual([id]);
    expect(await needingReply('needsReply=false')).toEqual([untouched]);

    await adminRespond(id);
    expect((await adminView(id)).needsReply).toBe(false);
    expect(await needingReply()).toEqual([]);
  });

  it('is cleared when the ticket reaches a final stage without a reply', async () => {
    const id = await createTicket();
    await authorReply(id);

    await request(ctx.app).patch(`/api/v1/tickets/${id}`).set(bearer(adminToken)).send({ status: 'Closed' });
    expect((await adminView(id)).needsReply).toBe(false);
  });

  it('counts legacy tickets without the field as not needing a reply', async () => {
    const id = await createTicket();
    await TicketModel.collection.updateOne({}, { $unset: { needsReply: '' } });
    expect(await needingReply('needsReply=false')).toEqual([id]);
  });

  it('rejects an invalid filter value', async () => {
    const res = await request(ctx.app).get('/api/v1/tickets?needsReply=maybe').set(bearer(adminToken));
    expect(res.status).toBe(400);
  });
});

describe('AI drafts after an author reply', () => {
  const draft = (id: string) =>
    request(ctx.app).post(`/api/v1/tickets/${id}/ai-draft`).set(bearer(adminToken)).send({});

  it('drops the cached draft and sends the reply to the model as an author message', async () => {
    let prompt = '';
    provider.onText = (req) => {
      prompt = req.prompt;
      return { text: DRAFT_TEXT, usage: fakeUsage };
    };
    const id = await createTicket();
    await draft(id);

    await authorReply(id, 'Which quarter does this cover?');
    expect((await TicketModel.findById(id).lean())!.aiDraft).toBeNull();

    await draft(id);
    expect(prompt).toMatch(/<message from="author"[^>]*>Which quarter does this cover\?<\/message>/);
    expect(prompt).toContain('answer the latest author message');
  });

  it('warns that the template does not cover the follow-up when the model is down', async () => {
    const id = await createTicket();
    const before = await draft(id);
    expect(before.body.data.warnings.join(' ')).not.toContain('latest message');

    await authorReply(id);
    const after = await draft(id);
    expect(after.body.data.fallback).toBe(true);
    expect(after.body.data.warnings.join(' ')).toContain('latest message');
  });
});
