import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuthorModel } from '../../src/models/author.model.js';
import { UserModel } from '../../src/models/user.model.js';
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
let adminToken: string;
let authorToken: string;

const validTicket = {
  queryType: 'General',
  subject: 'Where is my royalty?',
  description: 'My royalty payment has not arrived this quarter.',
};

beforeAll(async () => {
  await connectTestDb();
  ctx = buildContext();
});
beforeEach(async () => {
  await resetData();
  adminToken = await login(ctx.app, 'admin@bookleaf.com');
  authorToken = await login(ctx.app, 'priya@test.com');
});
afterAll(disconnectTestDb);

const getAuthors = (query: Record<string, string | number> = {}) =>
  request(ctx.app).get('/api/v1/admin/authors').query(query).set(bearer(adminToken));

async function raiseTicket(token: string) {
  const res = await request(ctx.app).post('/api/v1/tickets').set(bearer(token)).send(validTicket);
  expect(res.status).toBe(201);
  return res.body.data.id as string;
}

describe('GET /admin/authors', () => {
  it('lists every author alphabetically with book, royalty and ticket totals', async () => {
    await raiseTicket(authorToken);
    const resolved = await raiseTicket(authorToken);
    await request(ctx.app)
      .patch(`/api/v1/tickets/${resolved}`)
      .set(bearer(adminToken))
      .send({ status: 'Resolved' })
      .expect(200);

    const res = await getAuthors();

    expect(res.status).toBe(200);
    expect(res.body.meta).toEqual({ page: 1, limit: 20, total: 2 });
    expect(res.body.data.map((a: { authorId: string }) => a.authorId)).toEqual(['AUTH001', 'AUTH007']);
    expect(res.body.data[0]).toEqual({
      id: expect.any(String),
      authorId: 'AUTH001',
      name: 'Priya Sharma',
      email: 'priya@test.com',
      phone: null,
      city: 'Mumbai',
      joinedDate: '2023-03-15',
      totals: {
        books: 1,
        published: 1,
        inProduction: 0,
        copiesSold: 342,
        royaltyEarned: 11970,
        royaltyPaid: 8400,
        royaltyPending: 3570,
        tickets: 2,
        unresolvedTickets: 1,
      },
    });
    expect(res.body.data[1].totals).toMatchObject({ books: 2, published: 1, inProduction: 1, tickets: 0 });
  });

  it('never exposes account internals', async () => {
    const res = await getAuthors();
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|"role"/);
  });

  it.each([
    ['name, ignoring case', 'SNEHA', ['AUTH007']],
    ['email', 'priya@test', ['AUTH001']],
    ['author id', 'auth007', ['AUTH007']],
    ['city', 'mumbai', ['AUTH001']],
    ['nothing', 'no-such-author', []],
  ])('searches by %s', async (_label, q, expected) => {
    const res = await getAuthors({ q });
    expect(res.body.data.map((a: { authorId: string }) => a.authorId)).toEqual(expected);
    expect(res.body.meta.total).toBe(expected.length);
  });

  it('treats search input literally, not as a regular expression', async () => {
    const res = await getAuthors({ q: '.*' });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('paginates and reports the full total', async () => {
    const res = await getAuthors({ page: 2, limit: 1 });
    expect(res.body.meta).toEqual({ page: 2, limit: 1, total: 2 });
    expect(res.body.data.map((a: { authorId: string }) => a.authorId)).toEqual(['AUTH007']);
  });

  it('sorts names without regard to case', async () => {
    const user = await UserModel.create({
      email: 'aarav@test.com',
      name: 'aarav mehta',
      role: 'author',
      passwordHash: 'x',
    });
    await AuthorModel.create({ authorId: 'AUTH020', user: user._id, joinedDate: new Date('2024-01-01') });

    const res = await getAuthors();
    expect(res.body.data[0]).toMatchObject({
      authorId: 'AUTH020',
      name: 'aarav mehta',
      totals: { books: 0, copiesSold: 0, royaltyPending: 0, tickets: 0 },
    });
  });

  it('rejects an out-of-range limit', async () => {
    const res = await getAuthors({ limit: 101 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('GET /admin/authors/:authorId', () => {
  it('returns the profile, totals and all of the books', async () => {
    const res = await request(ctx.app).get('/api/v1/admin/authors/AUTH007').set(bearer(adminToken));

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      authorId: 'AUTH007',
      name: 'Sneha Kulkarni',
      email: 'sneha@test.com',
      totals: { books: 2, published: 1, inProduction: 1 },
    });
    expect(res.body.data.books.map((b: { bookId: string; isInProduction: boolean }) => [b.bookId, b.isInProduction])).toEqual([
      ['BK011', false],
      ['BK013', true],
    ]);
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
  });

  it('returns 404 for an unknown author', async () => {
    const res = await request(ctx.app).get('/api/v1/admin/authors/AUTH999').set(bearer(adminToken));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

describe('access control', () => {
  it.each(['/api/v1/admin/authors', '/api/v1/admin/authors/AUTH001'])('forbids authors from %s', async (path) => {
    const res = await request(ctx.app).get(path).set(bearer(authorToken));
    expect(res.status).toBe(403);
  });

  it.each(['/api/v1/admin/authors', '/api/v1/admin/authors/AUTH001'])('requires a token for %s', async (path) => {
    const res = await request(ctx.app).get(path);
    expect(res.status).toBe(401);
  });
});

describe('GET /tickets?authorId=', () => {
  it('lets an admin narrow the list to one author', async () => {
    const otherToken = await login(ctx.app, 'sneha@test.com');
    const priyaTicket = await raiseTicket(authorToken);
    await raiseTicket(otherToken);

    const res = await request(ctx.app).get('/api/v1/tickets').query({ authorId: 'AUTH001' }).set(bearer(adminToken));

    expect(res.body.meta.total).toBe(1);
    expect(res.body.data.map((t: { id: string }) => t.id)).toEqual([priyaTicket]);
  });

  it("does not let an author read someone else's tickets with it", async () => {
    const otherToken = await login(ctx.app, 'sneha@test.com');
    await raiseTicket(otherToken);
    const own = await raiseTicket(authorToken);

    const res = await request(ctx.app).get('/api/v1/tickets').query({ authorId: 'AUTH007' }).set(bearer(authorToken));

    expect(res.body.data.map((t: { id: string }) => t.id)).toEqual([own]);
  });
});
