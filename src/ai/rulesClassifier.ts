import { ticketFacts } from './facts.js';
import { applyPriorityFloors, atLeast, ISBN_ERROR } from './priorityRules.js';
import type { ClassificationResult, ClassifyInput, TicketCategory, TicketPriority } from './types.js';

/**
 * Keyword classifier used when the AI path is unavailable (no key, outage,
 * circuit open, invalid output). It is deliberately simple and explainable: it
 * only has to put the ticket in a sensible queue position until a human looks.
 */

interface CategoryRule {
  category: Exclude<TicketCategory, 'General Inquiry'>;
  /** [label shown to admins, pattern] */
  patterns: readonly (readonly [string, RegExp])[];
}

const CATEGORY_RULES: readonly CategoryRule[] = [
  {
    category: 'Royalty & Payments',
    patterns: [
      ['royalty', /\broyalt/i],
      ['payout', /\bpayout/i],
      ['payment', /\bpayment/i],
      ['paid', /\bpaid\b/i],
      ['bank details', /\bbank (?:account|details|transfer)/i],
      ['rupee amount', /₹|\brs\.?\s?\d|\binr\b|\brupee/i],
      ['earnings', /\bearning/i],
      ['statement', /\bstatement\b/i],
    ],
  },
  {
    category: 'ISBN & Metadata Issues',
    patterns: [
      ['ISBN', /\bisbn\b/i],
      ['imprint', /\bimprint\b/i],
      ['metadata', /\bmetadata\b/i],
      ['wrong listing details', /\bwrong (?:title|author name|price)\b/i],
    ],
  },
  {
    category: 'Printing & Quality',
    patterns: [
      ['print quality', /\bprint(?:ing|ed)? quality\b/i],
      ['misprint', /\bmisprint/i],
      ['binding', /\bbinding\b/i],
      ['blurry', /\bblurr/i],
      ['misaligned', /\bmisalign/i],
      ['defect', /\bdefect/i],
      ['reprint', /\breprint/i],
      ['damaged pages', /\bpages? (?:missing|torn|upside)/i],
      ['colour issue', /\bcolou?r (?:issue|problem|inconsisten)/i],
      ['author copies', /\bauthor copies\b/i],
    ],
  },
  {
    category: 'Distribution & Availability',
    patterns: [
      ['unavailable', /\bunavailable\b/i],
      ['out of stock', /\bout of stock\b/i],
      ['not listed', /\bnot (?:listed|available|showing)\b/i],
      ['listing', /\blisting\b/i],
      ['Amazon', /\bamazon\b/i],
      ['Flipkart', /\bflipkart\b/i],
      ['BookLeaf Store', /\bbookleaf store\b/i],
    ],
  },
  {
    category: 'Book Status & Production Updates',
    patterns: [
      ['typesetting', /\btypesetting\b/i],
      ['cover design', /\bcover design\b/i],
      ['proofs', /\bproof(?:read|s)\b/i],
      ['production', /\bproduction\b/i],
      ['editing', /\bediting\b/i],
      ['when will it be ready', /\bwhen will (?:my book|it) be\b/i],
      ['status', /\bstatus\b/i],
      ['delay', /\bdelay/i],
    ],
  },
];

const DEFAULT_PRIORITY: Record<TicketCategory, TicketPriority> = {
  'Royalty & Payments': 'Medium',
  'ISBN & Metadata Issues': 'Medium',
  'Printing & Quality': 'High',
  'Distribution & Availability': 'Medium',
  'Book Status & Production Updates': 'Medium',
  'General Inquiry': 'Low',
};

const ROYALTY_MISSING = /\b(not|never|haven'?t|didn'?t|no)\b[\s\S]{0,40}\b(received|got|paid|credited|royalt)/i;
const LONG_WAIT = /\b([6-9]|1[0-2]|six|seven|eight|nine|ten|eleven|twelve)\s+months\b|\b(a|one|over a)\s+year\b/i;
const PLATFORM_UNAVAILABLE = /\b(unavailable|out of stock|not (?:listed|available|showing))\b/i;
const EVERYWHERE = /\b(every|all) (?:platforms?|sites?|stores?)\b|\banywhere\b/i;
const URGENT = /\burgent|\basap\b|\bimmediately\b/i;

export function classifyByRules(input: ClassifyInput): ClassificationResult {
  const text = `${input.subject}\n${input.description}`;
  const facts = ticketFacts(input.book, input.now ?? new Date());

  // Subject matches count double: authors usually put the actual problem there.
  const scored = CATEGORY_RULES.map((rule) => {
    const matched = rule.patterns.filter(([, p]) => p.test(text)).map(([label]) => label);
    const subjectHits = rule.patterns.filter(([, p]) => p.test(input.subject)).length;
    return { rule, score: matched.length + subjectHits, matched };
  }).sort((a, b) => b.score - a.score);

  const best = scored[0];
  let category: TicketCategory = best && best.score > 0 ? best.rule.category : 'General Inquiry';
  // An ISBN error wins even when the ticket also names the store it saw it on.
  if (ISBN_ERROR.test(text)) category = 'ISBN & Metadata Issues';
  // "Unavailable" on a book still in production is a production question, not a distribution fault.
  if (category === 'Distribution & Availability' && input.book?.isInProduction) category = 'Book Status & Production Updates';

  let priority = DEFAULT_PRIORITY[category];
  if (category === 'Royalty & Payments' && ROYALTY_MISSING.test(text)) {
    priority = LONG_WAIT.test(text) ? 'Critical' : 'High';
  }
  if (category === 'Distribution & Availability' && PLATFORM_UNAVAILABLE.test(text)) {
    priority = EVERYWHERE.test(text) ? 'Critical' : 'High';
  }
  if (URGENT.test(text)) priority = atLeast(priority, 'High');

  const floors = applyPriorityFloors(category, priority, text, facts);
  const signals = best && best.score > 0 ? best.matched.slice(0, 3) : [];
  const reasoning = [
    `Rule-based classification (AI unavailable)${signals.length ? `; matched: ${signals.join(', ')}` : '; no strong keywords, defaulted'}.`,
    ...floors.notes,
  ].join(' ');

  return { category, priority: floors.priority, reasoning, confidence: null, source: 'rules' };
}
