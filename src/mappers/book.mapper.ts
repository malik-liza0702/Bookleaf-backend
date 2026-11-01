import { isInProductionStatus } from '../domain/enums.js';
import { toDateOnly } from '../lib/dates.js';
import type { BookDoc } from '../models/book.model.js';

export interface BookDto {
  id: string;
  bookId: string;
  title: string;
  isbn: string;
  genre: string;
  publicationDate: string | null;
  status: string;
  mrp: number | null;
  authorRoyaltyPerCopy: number | null;
  totalCopiesSold: number;
  totalRoyaltyEarned: number;
  royaltyPaid: number;
  royaltyPending: number;
  lastRoyaltyPayoutDate: string | null;
  printPartner: string | null;
  availableOn: string[];
  authorId: string;
  isInProduction: boolean;
}

export function toBookDto(book: BookDoc): BookDto {
  return {
    id: book._id.toString(),
    bookId: book.bookId,
    title: book.title,
    isbn: book.isbn,
    genre: book.genre,
    publicationDate: toDateOnly(book.publicationDate),
    status: book.status,
    mrp: book.mrp,
    authorRoyaltyPerCopy: book.authorRoyaltyPerCopy,
    totalCopiesSold: book.totalCopiesSold,
    totalRoyaltyEarned: book.totalRoyaltyEarned,
    royaltyPaid: book.royaltyPaid,
    royaltyPending: book.royaltyPending,
    lastRoyaltyPayoutDate: toDateOnly(book.lastRoyaltyPayoutDate),
    printPartner: book.printPartner,
    availableOn: book.availableOn,
    authorId: book.authorId,
    isInProduction: isInProductionStatus(book.status),
  };
}
