import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationModel } from '../../src/models/notification.model.js';
import {
  bearer,
  buildContext,
  connectTestDb,
  disconnectTestDb,
  login,
  resetData,
  type TestContext,
} from './helpers.js';

let ctx: Omit<TestContext, 'ids'>;
let authorToken: string;
let otherAuthorToken: string;
let adminToken: string;

beforeAll(async () => {
  await connectTestDb();
  ctx = buildContext();
});

beforeEach(async () => {
  await resetData();
  authorToken = await login(ctx.app, 'priya@test.com');
  otherAuthorToken = await login(ctx.app, 'sneha@test.com');
  adminToken = await login(ctx.app, 'admin@bookleaf.com');
});

afterAll(disconnectTestDb);

async function createTicket(token = authorToken): Promise<string> {
  const res = await request(ctx.app)
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

const reply = (ticketId: string, body: Record<string, unknown> = {}) =>
  request(ctx.app)
    .post(`/api/v1/tickets/${ticketId}/responses`)
    .set(bearer(adminToken))
    .send({ message: 'We are looking into this.', ...body });

const patch = (ticketId: string, body: Record<string, unknown>) =>
  request(ctx.app).patch(`/api/v1/tickets/${ticketId}`).set(bearer(adminToken)).send(body);

const list = (token = authorToken) => request(ctx.app).get('/api/v1/notifications').set(bearer(token));

const markRead = (body: Record<string, unknown> = {}, token = authorToken) =>
  request(ctx.app).post('/api/v1/notifications/read').set(bearer(token)).send(body);

describe('creating notifications', () => {
  it('notifies the author once for a reply that moves Open to In Progress', async () => {
    const ticketId = await createTicket();
    expect((await list()).body.meta.unreadCount).toBe(0);

    expect((await reply(ticketId)).status).toBe(201);

    const res = await list();
    expect(res.status).toBe(200);
    expect(res.body.meta).toEqual({ page: 1, limit: 20, total: 1, unreadCount: 1 });
    expect(res.body.data[0]).toEqual({
      id: expect.any(String),
      type: 'reply',
      ticketId,
      ticketNumber: 'TKT-0001',
      subject: 'Royalty payment missing',
      status: 'In Progress',
      message: 'BookLeaf Support replied and marked your query In Progress',
      read: false,
      createdAt: expect.any(String),
    });
  });

  it('leaves status null on a reply that does not change it', async () => {
    const ticketId = await createTicket();
    await reply(ticketId);
    await reply(ticketId);

    const { body } = await list();
    expect(body.data[0]).toMatchObject({
      type: 'reply',
      status: null,
      message: 'BookLeaf Support replied to your query',
    });
  });

  it('notifies on a status change, but not when PATCH resends the same status', async () => {
    const ticketId = await createTicket();
    await patch(ticketId, { status: 'Resolved' });
    await patch(ticketId, { status: 'Resolved' });

    const { body } = await list();
    expect(body.meta.total).toBe(1);
    expect(body.data[0]).toMatchObject({
      type: 'status_change',
      status: 'Resolved',
      message: 'Your query was marked Resolved',
    });
  });

  it('stays silent for notes, assignment, category and priority changes', async () => {
    const ticketId = await createTicket();
    await request(ctx.app)
      .post(`/api/v1/tickets/${ticketId}/notes`)
      .set(bearer(adminToken))
      .send({ text: 'Internal only' });
    await patch(ticketId, { assignedTo: 'me', category: 'General Inquiry', priority: 'Low' });

    expect((await list()).body.meta.total).toBe(0);
  });

  it('still saves the reply when the notification cannot be written', async () => {
    const ticketId = await createTicket();
    const create = vi.spyOn(NotificationModel, 'create').mockRejectedValueOnce(new Error('db down'));

    const res = await reply(ticketId);

    expect(res.status).toBe(201);
    expect(res.body.data.responses).toHaveLength(1);
    expect((await list()).body.meta.total).toBe(0);
    create.mockRestore();
  });
});

describe('reading notifications', () => {
  it('only shows authors their own notifications', async () => {
    await reply(await createTicket());
    expect((await list(otherAuthorToken)).body.meta).toMatchObject({ total: 0, unreadCount: 0 });
  });

  it('is author only', async () => {
    expect((await list(adminToken)).status).toBe(403);
    expect((await markRead({}, adminToken)).status).toBe(403);
    expect((await request(ctx.app).get('/api/v1/notifications')).status).toBe(401);
  });

  it('lists newest first and paginates, with the unread count across all pages', async () => {
    const ticketId = await createTicket();
    await reply(ticketId);
    await patch(ticketId, { status: 'Resolved' });

    const res = await request(ctx.app).get('/api/v1/notifications?limit=1').set(bearer(authorToken));
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].type).toBe('status_change');
    expect(res.body.meta).toEqual({ page: 1, limit: 1, total: 2, unreadCount: 2 });
  });
});

describe('POST /notifications/read', () => {
  it('marks only the given ticket as read', async () => {
    const first = await createTicket();
    const second = await createTicket();
    await reply(first);
    await reply(second);

    const res = await markRead({ ticketId: first });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ updated: 1 });

    const { body } = await list();
    expect(body.meta.unreadCount).toBe(1);
    expect(body.data.find((n: { ticketId: string }) => n.ticketId === first).read).toBe(true);
    expect(body.data.find((n: { ticketId: string }) => n.ticketId === second).read).toBe(false);
  });

  it('marks everything as read without a ticketId', async () => {
    await reply(await createTicket());
    await reply(await createTicket());

    expect((await markRead()).body.data).toEqual({ updated: 2 });
    expect((await list()).body.meta.unreadCount).toBe(0);
  });

  it("cannot touch another author's notifications", async () => {
    const ticketId = await createTicket();
    await reply(ticketId);

    expect((await markRead({ ticketId }, otherAuthorToken)).body.data).toEqual({ updated: 0 });
    expect((await markRead({}, otherAuthorToken)).body.data).toEqual({ updated: 0 });
    expect((await list()).body.meta.unreadCount).toBe(1);
  });

  it('rejects a malformed ticketId', async () => {
    const res = await markRead({ ticketId: 'nope' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
