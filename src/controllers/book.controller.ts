import type { Request, Response } from 'express';
import { currentUser } from '../middleware/auth.js';
import type { BookIdParams, ListBooksQuery } from '../schemas/book.schema.js';
import type { BookService } from '../services/book.service.js';

export function createBookController(books: BookService) {
  return {
    list: async (req: Request, res: Response) => {
      res.json({ data: await books.list(currentUser(req), req.query as ListBooksQuery) });
    },

    get: async (req: Request, res: Response) => {
      const { bookId } = req.params as BookIdParams;
      res.json({ data: await books.get(currentUser(req), bookId) });
    },
  };
}
