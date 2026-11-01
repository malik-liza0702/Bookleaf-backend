import { authorTextOf, checkDraft } from './draftChecks.js';
import { formatInr, ticketFacts, type TicketFacts } from './facts.js';
import { firstName, SIGN_OFF } from './prompts/draft.js';
import type { DraftInput, TicketCategory } from './types.js';

/**
 * Template starter reply used when the model is unavailable, so an admin is
 * never left with a blank box. Filled from the same computed facts as the AI
 * draft; everything it cannot know is a [confirm: …] placeholder. Optional for
 * the core: it may offer this as `aiDraft.fallback: true` alongside the 503.
 */

function longDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function bodyFor(category: TicketCategory, facts: TicketFacts): string[] {
  const book = facts.book;
  const title = book ? `"${book.title}"` : 'your book';
  switch (category) {
    case 'Royalty & Payments': {
      if (!book) {
        return [
          `Royalties are calculated quarterly and paid within 45 days of each quarter ending; the next payout deadline is ${longDate(facts.nextRoyaltyPayout.payoutBy)}.`,
          'Could you tell us which book this is about so we can check the exact figures? [confirm: book]',
        ];
      }
      const r = book.royalty;
      if (r.status === 'not_published' || r.status === 'no_earnings_yet') {
        return [
          `${title} has not earned any royalty yet${r.status === 'not_published' ? ', as it is still in production' : ''}. Royalties are calculated quarterly and paid within 45 days of each quarter ending, once the amount due reaches ${formatInr(facts.minimumPayoutInr)}.`,
        ];
      }
      const lastPayout = r.lastPayoutDate
        ? `your last payout was on ${longDate(r.lastPayoutDate)}`
        : `no payout has been made yet since publication${book.publicationDate ? ` on ${longDate(book.publicationDate)}` : ''}`;
      const lines = [
        `Our records show ${lastPayout}. For ${title} you have earned ${formatInr(r.totalEarnedInr)} in total, of which ${formatInr(r.paidInr)} has been paid and ${formatInr(r.pendingInr)} is pending.`,
        `Royalties are calculated quarterly and paid within 45 days of each quarter ending; the next scheduled payout is by ${longDate(r.nextScheduledPayoutBy)}.`,
      ];
      if (r.status === 'possibly_overdue') {
        // Ownership stays conditional: the record cannot show which quarter the pending amount is from.
        lines.push(
          `If any of the pending amount was due in an earlier cycle, that is on us and we will put it right. I have asked our finance team to confirm the breakdown within 48 hours. [confirm: finance breakdown of the pending amount by quarter]`,
        );
      } else if (r.status === 'below_threshold_rolls_over') {
        lines.push(`The pending amount is below our ${formatInr(facts.minimumPayoutInr)} minimum payout, so it rolls over to the next quarter and will be paid once it crosses that threshold.`);
      } else if (r.status === 'awaiting_next_payout') {
        lines.push(`The pending amount is not due yet; it will be paid by ${longDate(r.expectedPayoutBy!)}.`);
      }
      if (r.pendingInr > 0) lines.push('Please make sure your bank account is linked in your dashboard. [confirm: bank account linked?]');
      return lines;
    }
    case 'ISBN & Metadata Issues':
      return [
        `An ISBN or metadata error on ${title}${book ? ` (ISBN ${book.isbn})` : ''} is serious, and we are treating it as a priority.`,
        'I have escalated this to our production team, and we will come back to you with a resolution within 48 hours.',
        'If you have a screenshot of the listing showing the issue, please reply with it.',
      ];
    case 'Printing & Quality':
      return [
        `I am sorry to hear the copies of ${title} have not met the standard you expected.`,
        'Could you reply with a few photos of the affected pages or covers? Once we verify them, we will arrange a free reprint, which takes 5–7 business days from confirmation.',
      ];
    case 'Distribution & Availability':
      return [
        `When ${title} shows as unavailable on a platform, it is usually a stock sync issue.`,
        `${book?.listedOn.length ? `It is currently listed on ${book.listedOn.join(', ')}. ` : ''}We are triggering a re-sync with our distribution team, and it should be live again within 24–48 hours.`,
      ];
    case 'Book Status & Production Updates':
      return [
        book?.productionStage
          ? `${title} is currently at the ${book.productionStage} stage. After this come ${book.remainingStages.join(' → ')}.`
          : `${title} is currently marked "${book?.status ?? '[confirm: status]'}".`,
        `${book?.stageNote ? `${book.stageNote} ` : ''}We will confirm an updated timeline for you within 48 hours. [confirm: expected completion date]`,
      ];
    case 'General Inquiry':
      return ['[confirm: answer to the author’s question]', 'If anything else comes up, just reply to this message and we will help.'];
  }
}

export interface FallbackDraft {
  text: string;
  /** Same review checks as AI drafts (placeholders to fill, unknown amounts/dates). */
  warnings: string[];
}

export function buildFallbackDraft(input: DraftInput): FallbackDraft {
  const facts = ticketFacts(input.book, input.now);
  const name = firstName(input.author.name);
  const text = [
    `Dear ${name},`,
    `Thank you for reaching out about "${input.ticket.subject}". I understand why this matters, and I want to help sort it out.`,
    ...bodyFor(input.ticket.category, facts),
    SIGN_OFF,
  ].join('\n\n');
  const warnings = checkDraft(text, facts, authorTextOf(input));
  if (input.thread.at(-1)?.from === 'author') {
    warnings.push('This template does not address the author’s latest message. Read it and answer it before sending.');
  }
  return { text, warnings };
}
