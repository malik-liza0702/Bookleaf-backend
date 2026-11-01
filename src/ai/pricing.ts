import type { AiUsage } from './types.js';

/**
 * Gemini API paid-tier Standard prices in USD per 1M tokens, copied from
 * https://ai.google.dev/gemini-api/docs/pricing ("Last updated 2026-10-22").
 * 3.6/3.8 Flash have a promotional rate until 2026-12-31 and double from
 * 2027-01-01, so prices are kept as dated periods.
 * The core may override these from env (e.g. AI_PRICE_INPUT_PER_MTOK).
 */

export interface ModelPrice {
  inputPerMTok: number;
  outputPerMTok: number;
  cachedInputPerMTok: number;
}

interface PricePeriod extends ModelPrice {
  /** First day (UTC, inclusive) this price applies. */
  from: string;
}

export const PRICES_AS_OF = '2026-10-22';

const FLASH_3X: readonly PricePeriod[] = [
  { from: '2000-01-01', inputPerMTok: 0.75, outputPerMTok: 3.75, cachedInputPerMTok: 0.075 },
  { from: '2027-01-01', inputPerMTok: 1.5, outputPerMTok: 7.5, cachedInputPerMTok: 0.15 },
];

export const GEMINI_PRICES: Record<string, readonly PricePeriod[]> = {
  'gemini-3.8-flash': FLASH_3X,
  'gemini-3.6-flash': FLASH_3X,
  'gemini-3.5-flash-lite': [{ from: '2000-01-01', inputPerMTok: 0.3, outputPerMTok: 2.5, cachedInputPerMTok: 0.03 }],
  'gemini-3.1-flash-lite': [{ from: '2000-01-01', inputPerMTok: 0.25, outputPerMTok: 1.5, cachedInputPerMTok: 0.025 }],
  'gemini-2.5-flash': [{ from: '2000-01-01', inputPerMTok: 0.3, outputPerMTok: 2.5, cachedInputPerMTok: 0.03 }],
  'gemini-2.5-flash-lite': [{ from: '2000-01-01', inputPerMTok: 0.1, outputPerMTok: 0.4, cachedInputPerMTok: 0.01 }],
};

export function priceFor(model: string, at: Date = new Date()): ModelPrice | null {
  const periods = GEMINI_PRICES[model];
  if (!periods) return null;
  const day = at.toISOString().slice(0, 10);
  return [...periods].reverse().find((p) => p.from <= day) ?? null;
}

/**
 * Estimated USD cost of one call. Cached prompt tokens are billed at the cache
 * rate, the rest of the prompt at the input rate, output (incl. thinking) at the
 * output rate. Returns null for a model without a known price.
 */
export function estimateCostUsd(usage: Pick<AiUsage, 'model' | 'inputTokens' | 'outputTokens' | 'cacheReadTokens'>, override?: ModelPrice, at?: Date): number | null {
  const price = override ?? priceFor(usage.model, at);
  if (!price) return null;
  const cached = Math.min(usage.cacheReadTokens, usage.inputTokens);
  const cost =
    ((usage.inputTokens - cached) * price.inputPerMTok + cached * price.cachedInputPerMTok + usage.outputTokens * price.outputPerMTok) / 1_000_000;
  return Math.round(cost * 1e8) / 1e8;
}
