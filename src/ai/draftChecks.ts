import type { TicketFacts } from './facts.js';
import { SIGN_OFF } from './prompts/draft.js';
import type { DraftInput } from './types.js';

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

export function normalizeDraft(text: string): string {
  let draft = text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!draft.endsWith('BookLeaf Author Support')) draft = `${draft}\n\n${SIGN_OFF}`;
  return draft;
}

function amountsIn(text: string): Set<number> {
  const found = new Set<number>();
  for (const m of text.matchAll(/(?:₹|\brs\.?|\binr)\s?(\d[\d,]*(?:\.\d+)?)/gi)) {
    found.add(Number(m[1]!.replace(/,/g, '')));
  }
  return found;
}

function datesIn(text: string): Set<string> {
  const found = new Set<string>();
  for (const m of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) found.add(`${m[1]}-${m[2]}-${m[3]}`);
  const named = new RegExp(`\\b(\\d{1,2})\\s+(${MONTHS.join('|')})\\s+(\\d{4})\\b`, 'gi');
  for (const m of text.matchAll(named)) {
    const month = MONTHS.indexOf(m[2]!.toLowerCase()) + 1;
    found.add(`${m[3]}-${String(month).padStart(2, '0')}-${m[1]!.padStart(2, '0')}`);
  }
  return found;
}

function numbersIn(value: unknown, out: Set<number>): Set<number> {
  if (typeof value === 'number') out.add(value);
  else if (Array.isArray(value)) value.forEach((v) => numbersIn(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => numbersIn(v, out));
  return out;
}

export function authorTextOf(input: DraftInput): string {
  return [input.ticket.subject, input.ticket.description, ...input.thread.map((m) => m.message)].join('\n');
}

export function checkDraft(draft: string, facts: TicketFacts, authorText: string): string[] {
  const warnings: string[] = [];
  const factsJson = JSON.stringify(facts);

  const knownAmounts = numbersIn(facts, new Set<number>());
  amountsIn(authorText).forEach((a) => knownAmounts.add(a));
  const unknownAmounts = [...amountsIn(draft)].filter((a) => !knownAmounts.has(a));
  if (unknownAmounts.length) {
    warnings.push(`Check amount(s) not found in the book record: ${unknownAmounts.map((a) => `₹${a.toLocaleString('en-IN')}`).join(', ')}.`);
  }

  const knownDates = new Set([...datesIn(factsJson), ...datesIn(authorText)]);
  const unknownDates = [...datesIn(draft)].filter((d) => !knownDates.has(d));
  if (unknownDates.length) warnings.push(`Check date(s) not found in the record: ${unknownDates.join(', ')}.`);

  const placeholders = draft.match(/\[confirm:[^\]]*\]/gi) ?? [];
  if (placeholders.length) {
    warnings.push(`Fill in ${placeholders.length} placeholder(s) before sending: ${placeholders.join(' ')}`);
  }
  return warnings;
}
