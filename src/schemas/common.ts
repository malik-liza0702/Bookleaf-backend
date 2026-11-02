import { z } from 'zod';

export function text(options: { min?: number; max: number }) {
  const min = options.min ?? 1;
  return z
    .string({ error: (issue) => (issue.input === undefined ? 'Required' : 'Must be a string') })
    .trim()
    .min(min, min === 1 ? 'Required' : `Must be at least ${min} characters`)
    .max(options.max, `Must be at most ${options.max} characters`);
}

export function oneOf<const T extends readonly [string, ...string[]]>(values: T) {
  return z.enum(values, { error: () => `Must be one of: ${values.join(', ')}` });
}

export const isoDateParam = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Must be an ISO-8601 date or timestamp');

export const paginationQuery = z.object({
  page: z.coerce.number({ error: 'Must be a number' }).int().min(1, 'Must be at least 1').default(1),
  limit: z.coerce
    .number({ error: 'Must be a number' })
    .int()
    .min(1, 'Must be at least 1')
    .max(100, 'Must be at most 100')
    .default(20),
});

export const objectIdParam = z.string().regex(/^[a-f0-9]{24}$/i, 'Must be a valid id');
