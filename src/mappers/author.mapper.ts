import { isInProductionStatus } from '../domain/enums.js';
import { toDateOnly } from '../lib/dates.js';
import type { BookDoc } from '../models/book.model.js';
import type { AuthorRecord, AuthorTicketCounts } from '../repositories/user.repository.js';
import type { BookDto } from './book.mapper.js';

export interface AuthorTotals {
  books: number;
  published: number;
  inProduction: number;
  copiesSold: number;
  royaltyEarned: number;
  royaltyPaid: number;
  royaltyPending: number;
  tickets: number;
  unresolvedTickets: number;
}

export interface AuthorSummaryDto {
  id: string;
  authorId: string;
  name: string;
  email: string;
  phone: string | null;
  city: string | null;
  joinedDate: string | null;
  totals: AuthorTotals;
}

export interface AuthorDetailDto extends AuthorSummaryDto {
  books: BookDto[];
}

export function toAuthorSummaryDto(
  author: AuthorRecord,
  books: BookDoc[],
  tickets: AuthorTicketCounts,
): AuthorSummaryDto {
  const inProduction = books.filter((book) => isInProductionStatus(book.status)).length;
  const sum = (pick: (book: BookDoc) => number) => books.reduce((total, book) => total + pick(book), 0);
  return {
    id: author._id.toString(),
    authorId: author.authorId,
    name: author.user.name,
    email: author.user.email,
    phone: author.phone,
    city: author.city,
    joinedDate: toDateOnly(author.joinedDate),
    totals: {
      books: books.length,
      published: books.length - inProduction,
      inProduction,
      copiesSold: sum((book) => book.totalCopiesSold),
      royaltyEarned: sum((book) => book.totalRoyaltyEarned),
      royaltyPaid: sum((book) => book.royaltyPaid),
      royaltyPending: sum((book) => book.royaltyPending),
      tickets: tickets.total,
      unresolvedTickets: tickets.unresolved,
    },
  };
}
