import { Errors } from '../lib/errors.js';
import { toBookDto, type BookDto } from '../mappers/book.mapper.js';
import type { BookRepository } from '../repositories/book.repository.js';
import type { AuthUser } from '../types/express.js';

export class BookService {
  constructor(private readonly books: BookRepository) {}

  /** Authors always get their own books (any ?authorId= is ignored); admins may filter. */
  async list(user: AuthUser, query: { authorId?: string }): Promise<BookDto[]> {
    const authorId = user.role === 'author' ? user.authorId : query.authorId;
    if (user.role === 'author' && !authorId) return [];
    const books = await this.books.list({ authorId });
    return books.map(toBookDto);
  }

  /** Another author's book is reported as 404, not 403, so its existence does not leak. */
  async get(user: AuthUser, bookId: string): Promise<BookDto> {
    const book = await this.books.findByBookId(bookId);
    if (!book || (user.role === 'author' && book.authorId !== user.authorId)) {
      throw Errors.notFound('Book');
    }
    return toBookDto(book);
  }
}
