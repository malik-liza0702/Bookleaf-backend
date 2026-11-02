import { describe, expect, it } from 'vitest';
import { createAiService, estimateCostUsd, type AiUsage } from '../../src/ai/index.js';
import { book } from './helpers.js';

const apiKey = process.env.GEMINI_API_KEY;
const classifyModel = process.env.AI_CLASSIFY_MODEL ?? 'gemini-3.5-flash-lite';
const draftModel = process.env.AI_DRAFT_MODEL ?? 'gemini-3.8-flash';

const report = (label: string, usage: AiUsage | undefined) => {
  if (!usage) return;
  console.info(
    `[smoke] ${label}: model=${usage.model} in=${usage.inputTokens} out=${usage.outputTokens} cached=${usage.cacheReadTokens} ` +
      `latency=${usage.latencyMs}ms cost≈$${estimateCostUsd(usage)?.toFixed(6)}`,
  );
};

describe.skipIf(!apiKey)('Gemini smoke (real API)', () => {
  const ai = createAiService({ apiKey, classifyModel, draftModel });
  const now = new Date();

  it('classifies an ISBN mismatch as ISBN & Metadata, High or above', { timeout: 60_000 }, async () => {
    const result = await ai.classifyTicket({
      subject: 'Different ISBN on Amazon',
      description: 'The ISBN on my Amazon listing for Code & Karma does not match the one printed on my copies.',
      book: book('BK003'),
      now,
    });
    report('classify', result.usage);
    expect(result.error).toBeUndefined();
    expect(result.source).toBe('ai');
    expect(result.category).toBe('ISBN & Metadata Issues');
    expect(['Critical', 'High']).toContain(result.priority);
  });

  it('classifies a bio update as Low', { timeout: 60_000 }, async () => {
    const result = await ai.classifyTicket({ subject: 'Author bio', description: 'Can I update my author bio?', book: null, now });
    report('classify', result.usage);
    expect(result).toMatchObject({ source: 'ai', priority: 'Low' });
  });

  it('drafts a royalty reply that uses the real figures', { timeout: 90_000 }, async () => {
    const draft = await ai.generateDraft({
      ticket: {
        ticketNumber: 'TKT-9001',
        subject: 'No royalty received',
        description: "My book was published in July 2024 and I still haven't received a single royalty payment.",
        status: 'Open',
        category: 'Royalty & Payments',
        priority: 'High',
        createdAt: now.toISOString(),
      },
      author: { name: 'Ananya Reddy', city: 'Hyderabad' },
      book: book('BK005'),
      thread: [],
      now,
    });
    report('draft', draft.usage);
    console.info(`[smoke] draft warnings: ${JSON.stringify(draft.warnings)}\n${draft.text}`);
    expect(draft.text).toContain('2,546');
    expect(draft.text).toMatch(/^Dear Ananya,/);
    expect(draft.text.endsWith('BookLeaf Author Support')).toBe(true);
  });
});
