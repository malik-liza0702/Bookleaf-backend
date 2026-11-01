import type { TicketFacts } from './facts.js';
import { TICKET_PRIORITIES, type TicketCategory, type TicketPriority } from './types.js';

/**
 * Policy floors enforced in code, on top of whatever the model (or the rules
 * classifier) decided. They only ever raise priority. Business rules that must
 * hold every time do not belong only in a prompt.
 */

export const ISBN_ERROR =
  /\bisbn\b[\s\S]{0,80}\b(wrong|incorrect|different|mismatch(?:ed)?|duplicate[ds]?|error|invalid|missing|does(?:n'?t| not) match|not the same)\b|\b(wrong|incorrect|different|mismatch(?:ed)?|duplicate[ds]?|invalid)\b[\s\S]{0,80}\bisbn\b/i;
export const LEGAL_THREAT =
  /\b(lawyer|advocate|legal (?:action|notice)|consumer (?:court|forum)|sue|suing|court|police complaint|fraud|scam|cheat(?:ed|ing)?)\b/i;

const rank = (p: TicketPriority) => TICKET_PRIORITIES.indexOf(p); // 0 = Critical

export function atLeast(current: TicketPriority, floor: TicketPriority): TicketPriority {
  return rank(current) <= rank(floor) ? current : floor;
}

export interface FloorResult {
  priority: TicketPriority;
  notes: string[];
}

export function applyPriorityFloors(
  category: TicketCategory,
  priority: TicketPriority,
  text: string,
  facts: TicketFacts,
): FloorResult {
  const notes: string[] = [];
  let result = priority;
  const raise = (floor: TicketPriority, why: string) => {
    const next = atLeast(result, floor);
    if (next !== result) {
      notes.push(`Priority raised to ${floor}: ${why}.`);
      result = next;
    }
  };

  if (LEGAL_THREAT.test(text)) raise('Critical', 'the author mentions legal action or fraud');
  if (ISBN_ERROR.test(text)) raise('High', 'ISBN errors are always at least High under BookLeaf policy');
  // Possibly overdue is enough to triage higher: the cost of a late check is an unpaid author.
  if (category === 'Royalty & Payments' && facts.book?.royalty.status === 'possibly_overdue') {
    const r = facts.book.royalty;
    raise('High', `₹${r.pendingInr} pending since ${r.lastPayoutDate ? `the last payout on ${r.lastPayoutDate}` : 'publication (never paid)'} may include an overdue amount`);
  }
  return { priority: result, notes };
}
