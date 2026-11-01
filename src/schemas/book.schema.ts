import { z } from 'zod';

export const bookIdParams = z.object({
  bookId: z.string().trim().min(1).max(32),
});

export const listBooksQuery = z.object({
  authorId: z.string().trim().min(1).max(32).optional(),
});

export type BookIdParams = z.infer<typeof bookIdParams>;
export type ListBooksQuery = z.infer<typeof listBooksQuery>;
