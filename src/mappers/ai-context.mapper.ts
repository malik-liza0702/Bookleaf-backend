import type { BookContext } from '../ai/index.js';
import type { BookDoc } from '../models/book.model.js';
import { toBookDto } from './book.mapper.js';

export function toBookContext(book: BookDoc | null | undefined): BookContext | null {
  if (!book) return null;
  const dto = toBookDto(book);
  return {
    bookId: dto.bookId,
    title: dto.title,
    isbn: dto.isbn,
    status: dto.status,
    isInProduction: dto.isInProduction,
    publicationDate: dto.publicationDate,
    mrp: dto.mrp,
    authorRoyaltyPerCopy: dto.authorRoyaltyPerCopy,
    totalCopiesSold: dto.totalCopiesSold,
    totalRoyaltyEarned: dto.totalRoyaltyEarned,
    royaltyPaid: dto.royaltyPaid,
    royaltyPending: dto.royaltyPending,
    lastRoyaltyPayoutDate: dto.lastRoyaltyPayoutDate,
    printPartner: dto.printPartner,
    availableOn: dto.availableOn,
  };
}
