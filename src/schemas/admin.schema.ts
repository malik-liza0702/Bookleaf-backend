import { z } from 'zod';
import { paginationQuery } from './common.js';

export const aiUsageQuery = z.object({
  days: z.coerce
    .number({ error: 'Must be a number' })
    .int()
    .min(1, 'Must be at least 1')
    .max(365, 'Must be at most 365')
    .default(30),
});

export const listAuthorsQuery = paginationQuery.extend({
  q: z.string().trim().max(200).optional(),
});

export const authorIdParams = z.object({
  authorId: z.string().trim().min(1).max(32),
});

export type ListAuthorsQuery = z.infer<typeof listAuthorsQuery>;
export type AuthorIdParams = z.infer<typeof authorIdParams>;
export type AiUsageQuery = z.infer<typeof aiUsageQuery>;
