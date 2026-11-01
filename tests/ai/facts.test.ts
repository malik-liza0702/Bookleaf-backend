import { describe, expect, it } from 'vitest';
import { bookFacts, nextRoyaltyPayout, royaltyFacts } from '../../src/ai/facts.js';
import { allBookIds, book, NOW } from './helpers.js';

describe('nextRoyaltyPayout', () => {
  it.each([
    ['2026-10-26', '2026-09-30', '2026-11-14'], // inside Q3's 45-day window
    ['2026-11-14', '2026-09-30', '2026-11-14'], // deadline day itself
    ['2026-11-15', '2026-12-31', '2027-02-14'], // window passed → current quarter
    ['2026-01-01', '2025-12-31', '2026-02-14'], // year boundary
    ['2026-02-15', '2026-03-31', '2026-05-15'],
    ['2024-05-01', '2024-03-31', '2024-05-15'], // leap year: Mar 31 + 45 days
  ])('on %s → quarter %s, payout by %s', (today, quarterEnd, payoutBy) => {
    expect(nextRoyaltyPayout(new Date(`${today}T12:00:00Z`))).toEqual({ quarterEnd, payoutBy });
  });
});

describe('royaltyFacts on the sample dataset', () => {
  it('flags a never-paid book as POSSIBLY overdue, not overdue (Ananya Reddy, BK005)', () => {
    const facts = royaltyFacts(book('BK005'), NOW);
    expect(facts.status).toBe('possibly_overdue');
    expect(facts.pendingInr).toBe(2546);
    expect(facts.earliestPossibleDueDate).toBe('2024-11-14'); // Q3 2024 end + 45 days
    expect(facts.nextScheduledPayoutBy).toBe('2026-11-14');
    expect(facts.explanation).toContain('no payout yet');
    expect(facts.explanation).toContain('Do not state that a payment is late');
  });

  it('does not assert fault when the pending amount may all be recent (Priya Sharma, BK001)', () => {
    // Last payout 2025-10-15, ₹3,570 pending: it could all be Q3 2026 sales, due 2026-11-14.
    const facts = royaltyFacts(book('BK001'), NOW);
    expect(facts).toMatchObject({
      status: 'possibly_overdue',
      pendingInr: 3570,
      lastPayoutDate: '2025-10-15',
      earliestPossibleDueDate: '2026-02-14',
      nextScheduledPayoutBy: '2026-11-14',
      expectedPayoutBy: null,
    });
    expect(facts.explanation).toContain('does not show when it was earned');
    expect(facts.explanation).not.toMatch(/on BookLeaf's side|looks overdue|was due by|should have reached/);
  });

  it('reports fully paid books with their last payout date (BK002)', () => {
    const facts = royaltyFacts(book('BK002'), NOW);
    expect(facts.status).toBe('fully_paid');
    expect(facts.explanation).toContain('2025-12-01');
  });

  it('rolls amounts under ₹1,000 over to the next quarter (BK016, ₹850)', () => {
    const facts = royaltyFacts(book('BK016'), NOW);
    expect(facts.status).toBe('below_threshold_rolls_over');
    expect(facts.explanation).toContain('₹1,000');
  });

  it('treats books in production as not published, with zero royalties (BK013)', () => {
    expect(royaltyFacts(book('BK013'), NOW).status).toBe('not_published');
  });

  it('says a recent pending amount is awaiting the next payout, not overdue', () => {
    const recent = { ...book('BK001'), lastRoyaltyPayoutDate: '2026-10-15' };
    const facts = royaltyFacts(recent, NOW);
    expect(facts.status).toBe('awaiting_next_payout');
    expect(facts.expectedPayoutBy).toBe('2027-02-14');
  });
});

describe('bookFacts', () => {
  it('derives the production stage and what comes next (BK013 cover design)', () => {
    const facts = bookFacts(book('BK013'), NOW);
    expect(facts.published).toBe(false);
    expect(facts.productionStage).toBe('Cover Design');
    expect(facts.remainingStages[0]).toBe('Typesetting');
    expect(facts.remainingStages.at(-1)).toBe('Published & Live');
    expect(facts.stageNote).toMatch(/approve the cover/);
    expect(facts.notListedOn).toEqual([]);
  });

  it('lists platforms a published book is missing from', () => {
    expect(bookFacts(book('BK005'), NOW).notListedOn).toEqual(['Flipkart', 'Amazon US', 'Amazon UK']);
  });

  it('handles every dataset book without NaN, undefined or throwing', () => {
    for (const id of allBookIds()) {
      const serialized = JSON.stringify(bookFacts(book(id), NOW));
      expect(serialized).not.toMatch(/NaN|undefined/);
    }
  });
});
