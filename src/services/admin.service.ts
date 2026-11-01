import { PRICES_AS_OF } from '../ai/index.js';
import { Errors } from '../lib/errors.js';
import { toAuthorSummaryDto, type AuthorDetailDto, type AuthorSummaryDto } from '../mappers/author.mapper.js';
import { toBookDto } from '../mappers/book.mapper.js';
import type { AiCallLogRepository, AiUsageRow } from '../repositories/ai-call-log.repository.js';
import type { BookRepository } from '../repositories/book.repository.js';
import type { TicketRepository } from '../repositories/ticket.repository.js';
import type { UserRepository } from '../repositories/user.repository.js';

export interface AiUsageSummary {
  since: string;
  aiEnabled: boolean;
  pricesAsOf: string;
  totals: {
    calls: number;
    failures: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    estimatedCostUsd: number;
  };
  byKind: (AiUsageRow & { avgInputTokens: number; avgOutputTokens: number })[];
}

export class AdminService {
  constructor(
    private readonly users: UserRepository,
    private readonly books: BookRepository,
    private readonly tickets: TicketRepository,
    private readonly aiLogs: AiCallLogRepository,
    private readonly aiEnabled: boolean,
  ) {}

  async listAdmins() {
    const admins = await this.users.listAdmins();
    return admins.map((admin) => ({ id: admin._id.toString(), name: admin.name, email: admin.email }));
  }

  async listAuthors(query: { q?: string; page: number; limit: number }) {
    const { page, limit } = query;
    const { rows, total } = await this.users.listAuthors({ search: query.q || undefined, page, limit });
    const authorIds = rows.map((author) => author.authorId);
    const [books, ticketCounts] = await Promise.all([
      this.books.listForAuthors(authorIds),
      this.tickets.countsByAuthor(authorIds),
    ]);
    const data: AuthorSummaryDto[] = rows.map((author) =>
      toAuthorSummaryDto(
        author,
        books.filter((book) => book.authorId === author.authorId),
        ticketCounts.find((row) => row._id === author.authorId) ?? { total: 0, unresolved: 0 },
      ),
    );
    return { data, meta: { page, limit, total } };
  }

  async getAuthor(authorId: string): Promise<AuthorDetailDto> {
    const author = await this.users.findAuthorRecord(authorId);
    if (!author) throw Errors.notFound('Author');
    const [books, [ticketCounts]] = await Promise.all([
      this.books.list({ authorId }),
      this.tickets.countsByAuthor([authorId]),
    ]);
    return {
      ...toAuthorSummaryDto(author, books, ticketCounts ?? { total: 0, unresolved: 0 }),
      books: books.map(toBookDto),
    };
  }

  async stats() {
    const { countFor, critical, unassigned, oldestOpenAt } = await this.tickets.stats();
    return {
      open: countFor('Open'),
      inProgress: countFor('In Progress'),
      resolved: countFor('Resolved'),
      closed: countFor('Closed'),
      critical,
      unassigned,
      oldestOpenAt: oldestOpenAt?.toISOString() ?? null,
    };
  }

  async aiUsage(days: number): Promise<AiUsageSummary> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const rows = await this.aiLogs.summarize(since);
    const byKind = rows.map((row) => ({
      ...row,
      avgInputTokens: row.calls ? Math.round(row.inputTokens / row.calls) : 0,
      avgOutputTokens: row.calls ? Math.round(row.outputTokens / row.calls) : 0,
    }));
    const sum = (pick: (row: (typeof byKind)[number]) => number) =>
      byKind.reduce((total, row) => total + pick(row), 0);
    return {
      since: since.toISOString(),
      aiEnabled: this.aiEnabled,
      pricesAsOf: PRICES_AS_OF,
      totals: {
        calls: sum((r) => r.calls),
        failures: sum((r) => r.failures),
        inputTokens: sum((r) => r.inputTokens),
        outputTokens: sum((r) => r.outputTokens),
        cacheReadTokens: sum((r) => r.cacheReadTokens),
        estimatedCostUsd: Math.round(sum((r) => r.estimatedCostUsd) * 1e6) / 1e6,
      },
      byKind,
    };
  }
}
