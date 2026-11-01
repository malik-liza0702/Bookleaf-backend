import { z } from 'zod';

export const loginBody = z.object({
  email: z
    .string({ error: (issue) => (issue.input === undefined ? 'Required' : 'Must be a string') })
    .trim()
    .toLowerCase()
    .pipe(z.email('Must be a valid email address')),
  password: z
    .string({ error: (issue) => (issue.input === undefined ? 'Required' : 'Must be a string') })
    .min(1, 'Required')
    .max(200, 'Must be at most 200 characters'),
});

export type LoginBody = z.infer<typeof loginBody>;
