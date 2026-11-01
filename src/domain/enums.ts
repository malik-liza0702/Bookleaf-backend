import { TICKET_PRIORITIES, type TicketCategory, type TicketPriority } from '../ai/index.js';

/**
 * Enum values exactly as API_CONTRACT.md spells them. MongoDB stores these
 * labels as-is, so there is no translation layer between DB and API.
 */

export const ROLES = ['author', 'admin'] as const;
export type Role = (typeof ROLES)[number];

export const TICKET_STATUSES = ['Open', 'In Progress', 'Resolved', 'Closed'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const RESPONSE_SENDERS = ['author', 'support'] as const;
export type ResponseSender = (typeof RESPONSE_SENDERS)[number];

export const QUERY_TYPES = ['General', 'Account Level'] as const;
export type QueryType = (typeof QUERY_TYPES)[number];

// Category and priority lists are owned by the AI module (its prompts and
// schemas are built from them) and re-exported here, so there is one source.
export {
  TICKET_CATEGORIES,
  TICKET_PRIORITIES,
  type TicketCategory,
  type TicketPriority,
} from '../ai/index.js';
export const AI_STATUSES = ['pending', 'done', 'failed'] as const;
export type AiStatus = (typeof AI_STATUSES)[number];

export const AI_CALL_KINDS = ['classify', 'draft'] as const;
export type AiCallKind = (typeof AI_CALL_KINDS)[number];

export const NOTIFICATION_TYPES = ['reply', 'status_change'] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** Placeholders shown while classification is pending (per the contract). */
export const PENDING_CATEGORY: TicketCategory = 'General Inquiry';
export const PENDING_PRIORITY: TicketPriority = 'Medium';

/**
 * Numeric sort keys for the default "urgency" sort, stored on each ticket and
 * kept in sync on every write (see ticket.repository.ts). Lower = more urgent.
 */
export function statusRank(status: TicketStatus): number {
  return isUnresolvedStatus(status) ? 0 : 1;
}

export function priorityRank(priority: TicketPriority): number {
  return TICKET_PRIORITIES.indexOf(priority); // Critical 0 ... Low 3
}

/** Open and In Progress tickets still need work; Resolved and Closed do not. */
export function isUnresolvedStatus(status: TicketStatus): boolean {
  return status === 'Open' || status === 'In Progress';
}

/** Book statuses from the dataset look like "In Production - Cover Design". */
export function isInProductionStatus(status: string): boolean {
  return status.startsWith('In Production');
}

export function formatTicketNumber(n: number): string {
  return `TKT-${String(n).padStart(4, '0')}`;
}
