import {
  ALL_PLATFORMS,
  MIN_PAYOUT_THRESHOLD_INR,
  PAYOUT_DAYS_AFTER_QUARTER,
  PRODUCTION_STAGES,
} from './knowledgeBase.js';
import type { BookContext } from './types.js';

const DAY_MS = 86_400_000;

export function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function parseDate(value: string): Date {
  return new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
}

function startOfDay(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function quarterEndOf(d: Date): Date {
  const q = Math.floor(d.getUTCMonth() / 3);
  return new Date(Date.UTC(d.getUTCFullYear(), q * 3 + 3, 0));
}

function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * DAY_MS);
}

export function nextRoyaltyPayout(now: Date): { quarterEnd: string; payoutBy: string } {
  const today = startOfDay(now);
  const q = Math.floor(now.getUTCMonth() / 3);
  const previousQuarterEnd = new Date(Date.UTC(now.getUTCFullYear(), q * 3, 0));
  const previousPayoutBy = addDays(previousQuarterEnd, PAYOUT_DAYS_AFTER_QUARTER);
  const quarterEnd = previousPayoutBy.getTime() >= today ? previousQuarterEnd : quarterEndOf(now);
  return { quarterEnd: toIsoDate(quarterEnd), payoutBy: toIsoDate(addDays(quarterEnd, PAYOUT_DAYS_AFTER_QUARTER)) };
}

export type RoyaltyStatus =
  | 'not_published'
  | 'no_earnings_yet'
  | 'fully_paid'
  | 'below_threshold_rolls_over'
  | 'awaiting_next_payout'
  | 'possibly_overdue';

export interface RoyaltyFacts {
  status: RoyaltyStatus;
  explanation: string;
  totalEarnedInr: number;
  paidInr: number;
  pendingInr: number;
  lastPayoutDate: string | null;
  nextScheduledPayoutBy: string;
  expectedPayoutBy: string | null;
  earliestPossibleDueDate: string | null;
}

export interface BookFacts {
  bookId: string;
  title: string;
  isbn: string;
  status: string;
  published: boolean;
  publicationDate: string | null;
  monthsSincePublication: number | null;
  productionStage: string | null;
  remainingStages: string[];
  stageNote: string | null;
  copiesSold: number;
  mrpInr: number | null;
  royaltyPerCopyInr: number | null;
  royalty: RoyaltyFacts;
  printPartner: string | null;
  listedOn: string[];
  notListedOn: string[];
}

export interface TicketFacts {
  today: string;
  nextRoyaltyPayout: { quarterEnd: string; payoutBy: string };
  minimumPayoutInr: number;
  book: BookFacts | null;
}

export function formatInr(amount: number): string {
  return `₹${new Intl.NumberFormat('en-IN').format(amount)}`;
}

function monthsBetween(from: Date, to: Date): number {
  return Math.max(0, Math.floor((startOfDay(to) - startOfDay(from)) / (DAY_MS * 30.44)));
}

export function royaltyFacts(book: BookContext, now: Date): RoyaltyFacts {
  const next = nextRoyaltyPayout(now);
  const base = {
    totalEarnedInr: book.totalRoyaltyEarned,
    paidInr: book.royaltyPaid,
    pendingInr: book.royaltyPending,
    lastPayoutDate: book.lastRoyaltyPayoutDate,
    nextScheduledPayoutBy: next.payoutBy,
    expectedPayoutBy: null,
    earliestPossibleDueDate: null,
  };

  if (book.isInProduction || !book.publicationDate) {
    return { ...base, status: 'not_published', explanation: 'Book is not published yet, so no royalties have accrued.' };
  }
  if (book.totalRoyaltyEarned === 0) {
    return { ...base, status: 'no_earnings_yet', explanation: 'No royalty has been earned yet (no recorded sales).' };
  }
  if (book.royaltyPending === 0) {
    return {
      ...base,
      status: 'fully_paid',
      explanation: `All earned royalty has been paid${book.lastRoyaltyPayoutDate ? `; last payout on ${book.lastRoyaltyPayoutDate}` : ''}.`,
    };
  }
  if (book.royaltyPending < MIN_PAYOUT_THRESHOLD_INR) {
    return {
      ...base,
      status: 'below_threshold_rolls_over',
      explanation: `Pending ${formatInr(book.royaltyPending)} is below the ${formatInr(MIN_PAYOUT_THRESHOLD_INR)} minimum, so it rolls over to the next quarter. It will be paid once the total reaches ${formatInr(MIN_PAYOUT_THRESHOLD_INR)} (next scheduled payout by ${next.payoutBy}).`,
    };
  }

  const reference = parseDate(book.lastRoyaltyPayoutDate ?? book.publicationDate);
  const earliestDue = addDays(quarterEndOf(reference), PAYOUT_DAYS_AFTER_QUARTER);
  const since = book.lastRoyaltyPayoutDate
    ? `the last payout on ${book.lastRoyaltyPayoutDate}`
    : `publication on ${book.publicationDate} (no payout yet)`;
  if (earliestDue.getTime() < startOfDay(now)) {
    return {
      ...base,
      status: 'possibly_overdue',
      earliestPossibleDueDate: toIsoDate(earliestDue),
      explanation: `${formatInr(book.royaltyPending)} has accrued since ${since}. The record does not show when it was earned: if any of it is from sales before the most recent quarter, that part should already have been paid (earliest possible due date ${toIsoDate(earliestDue)}); if it is all recent, it is due with the next scheduled payout by ${next.payoutBy}. Finance must confirm the per-quarter breakdown. Do not state that a payment is late.`,
    };
  }
  return {
    ...base,
    status: 'awaiting_next_payout',
    expectedPayoutBy: toIsoDate(earliestDue),
    explanation: `${formatInr(book.royaltyPending)} has accrued since ${since} and is not due yet; it will be paid by ${toIsoDate(earliestDue)} under the quarterly cycle.`,
  };
}

function productionFacts(book: BookContext): Pick<BookFacts, 'productionStage' | 'remainingStages' | 'stageNote'> {
  if (!book.isInProduction) return { productionStage: null, remainingStages: [], stageNote: null };
  const stage = book.status.split(' - ')[1]?.trim() ?? null;
  const index = stage ? PRODUCTION_STAGES.indexOf(stage) : -1;
  const remainingStages = index >= 0 ? PRODUCTION_STAGES.slice(index + 1) : [];
  const stageNote =
    stage === 'Cover Design'
      ? 'Delays at Cover Design usually mean BookLeaf is waiting for the author to approve the cover.'
      : stage === 'Proofreading'
        ? 'Delays at Proofreading usually come from revision rounds.'
        : null;
  return { productionStage: stage, remainingStages, stageNote };
}

export function bookFacts(book: BookContext, now: Date): BookFacts {
  return {
    bookId: book.bookId,
    title: book.title,
    isbn: book.isbn,
    status: book.status,
    published: !book.isInProduction && book.publicationDate !== null,
    publicationDate: book.publicationDate,
    monthsSincePublication: book.publicationDate ? monthsBetween(parseDate(book.publicationDate), now) : null,
    ...productionFacts(book),
    copiesSold: book.totalCopiesSold,
    mrpInr: book.mrp,
    royaltyPerCopyInr: book.authorRoyaltyPerCopy,
    royalty: royaltyFacts(book, now),
    printPartner: book.printPartner,
    listedOn: book.availableOn,
    notListedOn: book.isInProduction ? [] : ALL_PLATFORMS.filter((p) => !book.availableOn.includes(p)),
  };
}

export function ticketFacts(book: BookContext | null, now: Date): TicketFacts {
  return {
    today: toIsoDate(now),
    nextRoyaltyPayout: nextRoyaltyPayout(now),
    minimumPayoutInr: MIN_PAYOUT_THRESHOLD_INR,
    book: book ? bookFacts(book, now) : null,
  };
}
