import { z } from 'zod';
import { QUERY_TYPES, TICKET_CATEGORIES, TICKET_PRIORITIES, TICKET_STATUSES } from '../domain/enums.js';
import { isoDateParam, objectIdParam, oneOf, paginationQuery, text } from './common.js';

const MAX_ATTACHMENTS = 5;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export const createTicketBody = z.object({
  queryType: oneOf(QUERY_TYPES),
  bookId: z.string().trim().min(1).max(32).nullish().transform((value) => value ?? null),
  subject: text({ min: 3, max: 150 }),
  description: text({ min: 10, max: 5000 }),
  attachments: z
    .array(
      z.object({
        name: text({ max: 255 }),
        size: z
          .number({ error: 'Must be a number' })
          .int()
          .min(0)
          .max(MAX_ATTACHMENT_BYTES, 'Attachments must be 10 MB or smaller'),
      }),
    )
    .max(MAX_ATTACHMENTS, `At most ${MAX_ATTACHMENTS} attachments`)
    .default([]),
});

export const listTicketsQuery = paginationQuery.extend({
  authorId: z.string().trim().min(1).max(32).optional(),
  status: oneOf(TICKET_STATUSES).optional(),
  category: oneOf(TICKET_CATEGORIES).optional(),
  priority: oneOf(TICKET_PRIORITIES).optional(),
  assignedTo: z.union([z.literal('me'), z.literal('unassigned'), objectIdParam]).optional(),
  from: isoDateParam.optional(),
  to: isoDateParam.optional(),
  q: z.string().trim().max(200).optional(),
  sort: oneOf(['urgency', 'newest', 'oldest'] as const).default('urgency'),
  needsReply: oneOf(['true', 'false'] as const).transform((value) => value === 'true').optional(),
  updatedSince: isoDateParam.optional(),
});

export const updateTicketBody = z
  .object({
    status: oneOf(TICKET_STATUSES).optional(),
    category: oneOf(TICKET_CATEGORIES).nullable().optional(),
    priority: oneOf(TICKET_PRIORITIES).nullable().optional(),
    assignedTo: z.union([z.literal('me'), objectIdParam]).nullable().optional(),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: 'Provide at least one of: status, category, priority, assignedTo',
  });

export const createResponseBody = z.object({
  message: text({ max: 5000 }),
  usedAiDraft: z.boolean({ error: 'Must be true or false' }).default(false),
  status: oneOf(TICKET_STATUSES).optional(),
});

export const createReplyBody = z.object({
  message: text({ max: 5000 }),
});

export const createNoteBody = z.object({
  text: text({ max: 2000 }),
});

export const aiDraftBody = z.object({
  regenerate: z.boolean({ error: 'Must be true or false' }).default(false),
  revision: z
    .object({
      previousDraft: text({ max: 5000 }),
      suggestions: text({ max: 1000 }),
    })
    .optional(),
});

export type CreateTicketBody = z.infer<typeof createTicketBody>;
export type ListTicketsQuery = z.infer<typeof listTicketsQuery>;
export type UpdateTicketBody = z.infer<typeof updateTicketBody>;
export type CreateResponseBody = z.infer<typeof createResponseBody>;
export type CreateReplyBody = z.infer<typeof createReplyBody>;
export type CreateNoteBody = z.infer<typeof createNoteBody>;
export type AiDraftBody = z.infer<typeof aiDraftBody>;
