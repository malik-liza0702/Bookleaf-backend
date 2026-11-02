import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import request from 'supertest';
import { inject } from 'vitest';
import { createAiService, ProviderError, type AiProvider, type AiService } from '../../src/ai/index.js';
import type { GenerateJsonRequest, GenerateRequest, ProviderResult } from '../../src/ai/provider.js';
import { createApp } from '../../src/app.js';
import { loadConfig } from '../../src/config/env.js';
import { createContainer, type Container } from '../../src/container.js';
import { createLogger } from '../../src/lib/logger.js';
import { AuthorModel } from '../../src/models/author.model.js';
import { BookModel } from '../../src/models/book.model.js';
import { UserModel } from '../../src/models/user.model.js';

export const PASSWORD = 'Secret@123';

export class FakeProvider implements AiProvider {
  readonly name = 'fake';
  jsonCalls = 0;
  textCalls = 0;

  constructor(
    public onJson: (req: GenerateJsonRequest) => ProviderResult = () => {
      throw new ProviderError('UNAVAILABLE', 'fake outage', { retryable: true });
    },
    public onText: (req: GenerateRequest) => ProviderResult = () => {
      throw new ProviderError('UNAVAILABLE', 'fake outage', { retryable: true });
    },
  ) {}

  async generateJson(req: GenerateJsonRequest): Promise<ProviderResult> {
    this.jsonCalls += 1;
    return this.onJson(req);
  }

  async generateText(req: GenerateRequest): Promise<ProviderResult> {
    this.textCalls += 1;
    return this.onText(req);
  }
}

export const fakeUsage = { inputTokens: 1200, outputTokens: 80, cacheReadTokens: 0 };

export function classificationResult(value: {
  category: string;
  priority: string;
  confidence?: number;
  reasoning?: string;
}): ProviderResult {
  return {
    text: JSON.stringify({
      reasoning: value.reasoning ?? 'Model reasoning.',
      category: value.category,
      priority: value.priority,
      confidence: value.confidence ?? 0.9,
    }),
    usage: fakeUsage,
  };
}

export const DRAFT_TEXT =
  'Dear Priya,\n\nThank you for reaching out. I have checked your royalty statement and our finance team will confirm the payout within 48 hours.\n\nWarm regards,\nBookLeaf Author Support';

export interface TestContext {
  app: ReturnType<typeof createApp>;
  container: Container;
  provider: FakeProvider;
  ids: { admin: string; ops: string };
}

export function aiServiceWith(provider: AiProvider): AiService {
  return createAiService(
    { classifyModel: 'gemini-3.5-flash-lite', draftModel: 'gemini-3.8-flash', maxRetries: 1, timeoutMs: 2000 },
    { provider, sleep: async () => {}, breaker: { failureThreshold: 1000 } },
  );
}

export async function connectTestDb(): Promise<void> {
  const uri = inject('mongoUri');
  const dbName = `test_${Math.random().toString(36).slice(2, 10)}`;
  await mongoose.connect(uri, { dbName });
  await Promise.all(Object.values(mongoose.models).map((model) => model.syncIndexes()));
}

export async function disconnectTestDb(): Promise<void> {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
}

export async function resetData(): Promise<TestContext['ids']> {
  await Promise.all(Object.values(mongoose.connection.collections).map((c) => c.deleteMany({})));
  const hash = await bcrypt.hash(PASSWORD, 4);

  const [admin, ops] = await UserModel.create([
    { email: 'admin@bookleaf.com', name: 'Asha Admin', role: 'admin', passwordHash: hash },
    { email: 'ops@bookleaf.com', name: 'Omar Ops', role: 'admin', passwordHash: hash },
  ]);
  const [priya, sneha] = await UserModel.create([
    { email: 'priya@test.com', name: 'Priya Sharma', role: 'author', passwordHash: hash },
    { email: 'sneha@test.com', name: 'Sneha Kulkarni', role: 'author', passwordHash: hash },
  ]);
  await AuthorModel.create([
    { authorId: 'AUTH001', user: priya!._id, city: 'Mumbai', joinedDate: new Date('2023-03-15') },
    { authorId: 'AUTH007', user: sneha!._id, city: 'Bangalore', joinedDate: new Date('2022-09-18') },
  ]);
  const published = {
    genre: 'Fiction',
    status: 'Published & Live',
    mrp: 399,
    authorRoyaltyPerCopy: 35,
    totalCopiesSold: 342,
    totalRoyaltyEarned: 11970,
    royaltyPaid: 8400,
    royaltyPending: 3570,
    publicationDate: new Date('2023-06-20'),
    lastRoyaltyPayoutDate: new Date('2025-10-15'),
    printPartner: 'In-House',
    availableOn: ['Amazon India', 'Flipkart'],
  };
  await BookModel.create([
    { ...published, bookId: 'BK001', authorId: 'AUTH001', title: 'Whispers of the Ganges', isbn: '978-1' },
    { ...published, bookId: 'BK011', authorId: 'AUTH007', title: 'The Algorithm of Love', isbn: '978-11' },
    {
      bookId: 'BK013',
      authorId: 'AUTH007',
      title: 'Midnight in Mysore',
      isbn: '978-13',
      genre: 'Thriller',
      status: 'In Production - Cover Design',
    },
  ]);
  return { admin: admin!._id.toString(), ops: ops!._id.toString() };
}

export function buildContext(provider = new FakeProvider(), env: Record<string, string> = {}): Omit<TestContext, 'ids'> {
  const config = loadConfig({
    NODE_ENV: 'test',
    MONGODB_URI: inject('mongoUri'),
    JWT_SECRET: 'test-secret-that-is-at-least-32-characters-long',
    LOG_LEVEL: 'silent',
    TICKET_RATE_LIMIT_MAX: '1000',
    ...env,
  });
  const logger = createLogger({ level: 'silent', pretty: false });
  const container = createContainer(config, logger, { ai: aiServiceWith(provider) });
  return { app: createApp(container), container, provider };
}

export async function login(app: TestContext['app'], email: string): Promise<string> {
  const res = await request(app).post('/api/v1/auth/login').send({ email, password: PASSWORD });
  if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status}`);
  return res.body.data.token as string;
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
