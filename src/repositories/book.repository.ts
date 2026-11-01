import { BookModel } from '../models/book.model.js';

export class BookRepository {
  list(filter: { authorId?: string }) {
    return BookModel.find(filter.authorId ? { authorId: filter.authorId } : {})
      .sort({ bookId: 1 })
      .lean();
  }

  listForAuthors(authorIds: string[]) {
    return BookModel.find({ authorId: { $in: authorIds } })
      .sort({ bookId: 1 })
      .lean();
  }

  findByBookId(bookId: string) {
    return BookModel.findOne({ bookId }).lean();
  }
}
