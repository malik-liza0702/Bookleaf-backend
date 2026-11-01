import { ApiError, FinishReason, ThinkingLevel } from '@google/genai';
import { describe, expect, it, vi } from 'vitest';
import { estimateCostUsd } from '../../src/ai/index.js';
import { GeminiProvider, parseRetryDelayMs, thinkingConfigFor } from '../../src/ai/geminiProvider.js';
import { ProviderError } from '../../src/ai/provider.js';
import { withRetry } from '../../src/ai/retry.js';

describe('withRetry', () => {
  it('waits at least the server-requested retry-after', async () => {
    const sleeps: number[] = [];
    let calls = 0;
    const result = await withRetry(
      async () => {
        if (++calls === 1) throw new ProviderError('RATE_LIMITED', '429', { retryable: true, retryAfterMs: 3000 });
        return 'ok';
      },
      { maxRetries: 2, timeoutMs: 1000, sleep: async (ms) => void sleeps.push(ms), random: () => 0 },
    );
    expect(result).toBe('ok');
    expect(sleeps).toEqual([3000]);
  });

  it('gives up instead of waiting longer than maxDelayMs', async () => {
    let calls = 0;
    const promise = withRetry(
      async () => {
        calls++;
        throw new ProviderError('RATE_LIMITED', '429', { retryable: true, retryAfterMs: 60_000 });
      },
      { maxRetries: 2, timeoutMs: 1000, sleep: async () => {} },
    );
    await expect(promise).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    expect(calls).toBe(1);
  });

  it('times out a hung attempt, aborts it and retries', async () => {
    const signals: AbortSignal[] = [];
    let calls = 0;
    const result = await withRetry(
      (signal) => {
        signals.push(signal);
        return ++calls === 1 ? new Promise<string>(() => {}) : Promise.resolve('second');
      },
      { maxRetries: 1, timeoutMs: 20, sleep: async () => {} },
    );
    expect(result).toBe('second');
    expect(signals[0]!.aborted).toBe(true);
  });
});

describe('GeminiProvider', () => {
  const req = { model: 'gemini-3.5-flash-lite', system: 'sys', prompt: 'hi', maxOutputTokens: 100, thinking: 'minimal' as const };

  function provider(response: unknown | Error) {
    const p = new GeminiProvider('SECRET-KEY-123');
    const spy = vi.fn(async () => {
      if (response instanceof Error) throw response;
      return response;
    });
    // Replace the SDK call; everything else (config building, mapping) is the real code.
    (p as unknown as { client: { models: { generateContent: typeof spy } } }).client.models.generateContent = spy;
    return { p, spy };
  }

  const response = (finishReason: FinishReason, text = '{"a":1}') => ({
    text,
    candidates: [{ finishReason }],
    usageMetadata: { promptTokenCount: 800, candidatesTokenCount: 40, thoughtsTokenCount: 25, cachedContentTokenCount: 0 },
  });

  it('builds the request without sampling params and maps usage (thinking counts as output)', async () => {
    const { p, spy } = provider(response(FinishReason.STOP));
    const result = await p.generateJson({ ...req, schema: { type: 'string' } });
    expect(result).toEqual({ text: '{"a":1}', usage: { inputTokens: 800, outputTokens: 65, cacheReadTokens: 0 } });
    const config = (spy.mock.calls[0] as unknown as [{ config: Record<string, unknown> }])[0].config;
    expect(config).toMatchObject({ systemInstruction: 'sys', responseMimeType: 'application/json', maxOutputTokens: 100 });
    expect(config).not.toHaveProperty('temperature');
  });

  it('treats MAX_TOKENS as invalid output and SAFETY as blocked, keeping usage', async () => {
    await expect(provider(response(FinishReason.MAX_TOKENS)).p.generateText(req)).rejects.toMatchObject({
      code: 'INVALID_OUTPUT',
      options: { usage: { inputTokens: 800 } },
    });
    await expect(provider(response(FinishReason.SAFETY)).p.generateText(req)).rejects.toMatchObject({ code: 'BLOCKED' });
  });

  it('maps 429 with RetryInfo, 503 and auth errors, and never leaks the key', async () => {
    const rateLimited = new ApiError({ status: 429, message: '{"error":{"details":[{"retryDelay": "7s"}]}}' });
    await expect(provider(rateLimited).p.generateText(req)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      options: { retryable: true, retryAfterMs: 7000 },
    });
    await expect(provider(new ApiError({ status: 503, message: 'overloaded' })).p.generateText(req)).rejects.toMatchObject({
      code: 'UNAVAILABLE',
      retryable: true,
    });
    const auth = await provider(new ApiError({ status: 403, message: 'bad key SECRET-KEY-123' })).p.generateText(req).catch((e: Error) => e);
    expect(auth).toMatchObject({ code: 'UNKNOWN', retryable: false });
    expect((auth as Error).message).not.toContain('SECRET-KEY-123');
    const network = await provider(new TypeError('fetch failed for key=SECRET-KEY-123')).p.generateText(req).catch((e: Error) => e);
    expect(network).toMatchObject({ code: 'UNAVAILABLE', retryable: true });
    expect((network as Error).message).toContain('[redacted]');
  });

  it('picks the right thinking knob per model generation', () => {
    expect(thinkingConfigFor('gemini-3.5-flash-lite', 'minimal')).toEqual({ thinkingLevel: ThinkingLevel.MINIMAL });
    expect(thinkingConfigFor('gemini-3.8-flash', 'minimal')).toEqual({ thinkingLevel: ThinkingLevel.LOW }); // 3.8 Flash rejects MINIMAL
    expect(thinkingConfigFor('gemini-3.8-flash', 'low')).toEqual({ thinkingLevel: ThinkingLevel.LOW });
    expect(thinkingConfigFor('gemini-2.5-flash', 'minimal')).toEqual({ thinkingBudget: 0 });
  });

  it('parses retryDelay from 429 bodies', () => {
    expect(parseRetryDelayMs('"retryDelay": "1.5s"')).toBe(1500);
    expect(parseRetryDelayMs('no info')).toBeUndefined();
  });
});

describe('estimateCostUsd', () => {
  it('prices input, cached input and output separately, using the dated price', () => {
    const usage = { model: 'gemini-3.8-flash', inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 500_000 };
    // 0.5M × $0.75 + 0.5M × $0.075 + 1M × $3.75
    expect(estimateCostUsd(usage, undefined, new Date('2026-10-26'))).toBeCloseTo(4.1625, 6);
    // Same tokens after the promotional period ends
    expect(estimateCostUsd(usage, undefined, new Date('2027-01-01'))).toBeCloseTo(8.325, 6);
    expect(estimateCostUsd({ ...usage, model: 'unknown-model' })).toBeNull();
  });
});
