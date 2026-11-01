import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { KB_SAMPLES, KB_SECTIONS, selectKbSections } from '../../src/ai/knowledgeBase.js';

const source = readFileSync(fileURLToPath(new URL('../../data/knowledge_base_source.md', import.meta.url)), 'utf8');
// The source file and the PDF mix straight and curly apostrophes; compare without caring.
const normalize = (s: string) => s.replace(/[‘’]/g, "'").replace(/\s+/g, ' ');

describe('knowledge base', () => {
  it('matches data/knowledge_base_source.md verbatim (no drift)', () => {
    const text = normalize(source);
    for (const section of Object.values(KB_SECTIONS)) {
      expect(text).toContain(`## ${section.title}`);
      for (const bullet of section.bullets) expect(text).toContain(normalize(bullet));
    }
    for (const sample of KB_SAMPLES) {
      expect(text).toContain(normalize(sample.query));
      expect(text).toContain(normalize(sample.guidance));
    }
  });

  it('selects only the primary section for a plain ticket', () => {
    expect(selectKbSections('Printing & Quality', 'Pages are misaligned').map((s) => s.id)).toEqual(['printingQuality']);
    expect(selectKbSections('General Inquiry', 'Can I change my bio?')).toEqual([]);
  });

  it('adds at most one secondary section', () => {
    const ids = selectKbSections('General Inquiry', 'ISBN, royalty, reprint, unavailable, typesetting').map((s) => s.id);
    expect(ids).toHaveLength(1);
  });
});
