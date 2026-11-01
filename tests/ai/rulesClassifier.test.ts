import { describe, expect, it } from 'vitest';
import { classifyByRules } from '../../src/ai/index.js';
import { book, NOW } from './helpers.js';

const classify = (subject: string, description: string, bookId?: string) =>
  classifyByRules({ subject, description, book: bookId ? book(bookId) : null, now: NOW });

describe('classifyByRules', () => {
  it.each([
    ['ISBN mismatch', 'Amazon shows a different ISBN than the one on my printed copy.', 'ISBN & Metadata Issues', 'High'],
    ['Copies arrived damaged', 'The binding is coming apart and images are blurry in my author copies.', 'Printing & Quality', 'High'],
    ['Unavailable on Amazon', 'My book shows currently unavailable on Amazon India.', 'Distribution & Availability', 'High'],
    ['Where is my book?', 'It has been stuck in typesetting for three weeks. Any update on the status?', 'Book Status & Production Updates', 'Medium'],
    ['Update my author bio', 'Can I change the bio on my author page?', 'General Inquiry', 'Low'],
    ['Royalty breakdown', 'How is the royalty per copy calculated?', 'Royalty & Payments', 'Medium'],
    ['No royalty', 'I have not received any royalty for 6 months now.', 'Royalty & Payments', 'Critical'],
  ] as const)('%s → %s / %s', (subject, description, category, priority) => {
    const result = classify(subject, description);
    expect(result).toMatchObject({ category, priority, source: 'rules', confidence: null });
    expect(result.reasoning).toMatch(/^Rule-based classification/);
  });

  it('escalates legal threats to Critical whatever the category', () => {
    const result = classify('Cover question', 'If the cover is not fixed I will send a legal notice.');
    expect(result.priority).toBe('Critical');
    expect(result.reasoning).toContain('legal action');
  });

  it('uses book facts: an overdue royalty is at least High (BK005 never paid)', () => {
    const result = classify('Royalty question', 'How much royalty do I have?', 'BK005');
    expect(result).toMatchObject({ category: 'Royalty & Payments', priority: 'High' });
    expect(result.reasoning).toContain('may include an overdue amount');
  });

  it('treats "not available" on a book still in production as a production question (BK013)', () => {
    expect(classify('Not available', 'My book is not available on Amazon yet.', 'BK013').category).toBe(
      'Book Status & Production Updates',
    );
  });

  it('falls back to General Inquiry / Low when nothing matches', () => {
    expect(classify('Hello', 'Just wanted to say thanks!')).toMatchObject({ category: 'General Inquiry', priority: 'Low' });
  });
});
