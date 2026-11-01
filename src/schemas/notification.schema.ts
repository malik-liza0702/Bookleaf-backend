import { z } from 'zod';
import { objectIdParam, paginationQuery } from './common.js';

export const listNotificationsQuery = paginationQuery;

export const markNotificationsReadBody = z.object({
  /** Limits the update to one ticket; without it, everything is marked read. */
  ticketId: objectIdParam.optional(),
});

export type ListNotificationsQuery = z.infer<typeof listNotificationsQuery>;
export type MarkNotificationsReadBody = z.infer<typeof markNotificationsReadBody>;
