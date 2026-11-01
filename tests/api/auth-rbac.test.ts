import bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { UserModel } from '../../src/models/user.model.js';
import {
  bearer,
  buildContext,
  connectTestDb,
  disconnectTestDb,
  login,
  PASSWORD,
  resetData,
  type TestContext,
} from './helpers.js';

let ctx: Omit<TestContext, 'ids'>;

beforeAll(async () => {
  await connectTestDb();
  ctx = buildContext();
});
beforeEach(async () => {
  await resetData();
});
afterAll(disconnectTestDb);

describe('auth', () => {
  it('logs an author in and returns a token plus the user with authorId', async () => {
    const res = await request(ctx.app)
      .post('/api/v1/auth/login')
      .send({ email: 'PRIYA@test.com ', password: PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.data.token).toEqual(expect.any(String));
    expect(res.body.data.user).toMatchObject({
      email: 'priya@test.com',
      name: 'Priya Sharma',
      role: 'author',
      authorId: 'AUTH001',
    });
    expect(res.body.data.user).not.toHaveProperty('passwordHash');
  });

  it('returns the same 401 message for an unknown email and a wrong password', async () => {
    const unknown = await request(ctx.app)
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@test.com', password: PASSWORD });
    const wrong = await request(ctx.app)
      .post('/api/v1/auth/login')
      .send({ email: 'priya@test.com', password: 'wrong-password' });

    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(unknown.body).toEqual(wrong.body);
    expect(wrong.body.error).toEqual({ code: 'UNAUTHENTICATED', message: 'Invalid email or password' });
  });

  it('rejects an admin login whose email is not on the @bookleaf.com domain', async () => {
    await UserModel.create({
      email: 'rogue@gmail.com',
      name: 'Rogue Admin',
      role: 'admin',
      passwordHash: await bcrypt.hash(PASSWORD, 4),
    });

    const res = await request(ctx.app)
      .post('/api/v1/auth/login')
      .send({ email: 'rogue@gmail.com', password: PASSWORD });

    expect(res.status).toBe(403);
    expect(res.body.error).toEqual({
      code: 'FORBIDDEN',
      message: 'Admin accounts must use a @bookleaf.com email address',
    });
  });

  it('rejects a malformed login body with field-level VALIDATION_ERROR details', async () => {
    const res = await request(ctx.app).post('/api/v1/auth/login').send({ email: 'not-an-email' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details).toEqual(
      expect.arrayContaining([
        { field: 'email', message: 'Must be a valid email address' },
        { field: 'password', message: 'Required' },
      ]),
    );
  });

  it('GET /auth/me returns the current user and 401s without a valid token', async () => {
    const token = await login(ctx.app, 'admin@bookleaf.com');
    const me = await request(ctx.app).get('/api/v1/auth/me').set(bearer(token));
    expect(me.status).toBe(200);
    expect(me.body.data).toMatchObject({ email: 'admin@bookleaf.com', role: 'admin' });
    expect(me.body.data).not.toHaveProperty('authorId');

    const missing = await request(ctx.app).get('/api/v1/auth/me');
    expect(missing.status).toBe(401);
    const forged = await request(ctx.app).get('/api/v1/auth/me').set(bearer('not.a.jwt'));
    expect(forged.status).toBe(401);
    expect(forged.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('serves health and returns the contract error shape for unknown routes', async () => {
    expect((await request(ctx.app).get('/api/v1/health')).body).toEqual({ status: 'ok' });
    const token = await login(ctx.app, 'admin@bookleaf.com');
    const res = await request(ctx.app).get('/api/v1/nope').set(bearer(token));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('turns malformed JSON into VALIDATION_ERROR instead of a 500', async () => {
    const res = await request(ctx.app)
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email": ');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('RBAC', () => {
  it('returns 403 FORBIDDEN when an author calls admin routes', async () => {
    const token = await login(ctx.app, 'priya@test.com');
    const fakeId = '64b7f0c2a1b2c3d4e5f60718';
    const calls = [
      request(ctx.app).get('/api/v1/admin/stats').set(bearer(token)),
      request(ctx.app).get('/api/v1/admin/users').set(bearer(token)),
      request(ctx.app).get('/api/v1/admin/ai-usage').set(bearer(token)),
      request(ctx.app).patch(`/api/v1/tickets/${fakeId}`).set(bearer(token)).send({ status: 'Closed' }),
      request(ctx.app).post(`/api/v1/tickets/${fakeId}/responses`).set(bearer(token)).send({ message: 'hi' }),
      request(ctx.app).post(`/api/v1/tickets/${fakeId}/notes`).set(bearer(token)).send({ text: 'hi' }),
      request(ctx.app).post(`/api/v1/tickets/${fakeId}/ai-draft`).set(bearer(token)).send({}),
    ];
    for (const res of await Promise.all(calls)) {
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }
  });

  it('does not let an admin create tickets (author-only route)', async () => {
    const token = await login(ctx.app, 'admin@bookleaf.com');
    const res = await request(ctx.app)
      .post('/api/v1/tickets')
      .set(bearer(token))
      .send({ subject: 'Hello there', description: 'A long enough description.' });
    expect(res.status).toBe(403);
  });
});

describe('books', () => {
  it('authors only see their own books, even if they pass ?authorId=', async () => {
    const token = await login(ctx.app, 'priya@test.com');
    const res = await request(ctx.app).get('/api/v1/books?authorId=AUTH007').set(bearer(token));
    expect(res.status).toBe(200);
    expect(res.body.data.map((b: { bookId: string }) => b.bookId)).toEqual(['BK001']);
  });

  it("returns 404 (not 403) when an author requests another author's book", async () => {
    const token = await login(ctx.app, 'priya@test.com');
    const res = await request(ctx.app).get('/api/v1/books/BK011').set(bearer(token));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('lets admins list by author and read any book; in-production books have null money fields', async () => {
    const token = await login(ctx.app, 'admin@bookleaf.com');
    const list = await request(ctx.app).get('/api/v1/books?authorId=AUTH007').set(bearer(token));
    expect(list.body.data.map((b: { bookId: string }) => b.bookId)).toEqual(['BK011', 'BK013']);

    const res = await request(ctx.app).get('/api/v1/books/BK013').set(bearer(token));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      bookId: 'BK013',
      authorId: 'AUTH007',
      isInProduction: true,
      mrp: null,
      publicationDate: null,
      royaltyPending: 0,
      availableOn: [],
    });
    expect(res.body.data).not.toHaveProperty('_id');
    expect(res.body.data).not.toHaveProperty('__v');
  });
});
