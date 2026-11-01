import { ProviderError } from './provider.js';

export interface RetryOptions {
  /** Retries after the first attempt. */
  maxRetries: number;
  /** Per-attempt timeout; the attempt's AbortSignal fires when it elapses. */
  timeoutMs: number;
  baseDelayMs?: number;
  /**
   * Longest we are willing to wait between attempts. If the server asks for a
   * longer pause (retry-after), we give up immediately rather than hold an admin's
   * request open: the caller degrades instead.
   */
  maxDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Runs `fn` with a per-attempt timeout and bounded exponential backoff (full
 * jitter) on retryable ProviderErrors: 429, 5xx and timeouts. Anything else
 * (safety block, bad request, invalid output) fails straight away.
 */
export async function withRetry<T>(fn: (signal: AbortSignal) => Promise<T>, opts: RetryOptions): Promise<T> {
  const sleep = opts.sleep ?? defaultSleep;
  const random = opts.random ?? Math.random;
  const baseDelayMs = opts.baseDelayMs ?? 500;
  const maxDelayMs = opts.maxDelayMs ?? 8_000;

  for (let attempt = 0; ; attempt++) {
    try {
      return await runWithTimeout(fn, opts.timeoutMs);
    } catch (err) {
      const error = toProviderError(err);
      if (!error.retryable || attempt >= opts.maxRetries) throw error;

      const backoff = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt) * random();
      const requested = error.options.retryAfterMs;
      if (requested !== undefined && requested > maxDelayMs) throw error;
      await sleep(Math.max(backoff, requested ?? 0));
    }
  }
}

async function runWithTimeout<T>(fn: (signal: AbortSignal) => Promise<T>, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new ProviderError('TIMEOUT', `AI call timed out after ${timeoutMs}ms`, { retryable: true }));
    }, timeoutMs);
  });
  try {
    return await Promise.race([fn(controller.signal), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function toProviderError(err: unknown): ProviderError {
  if (err instanceof ProviderError) return err;
  const message = err instanceof Error ? err.message : String(err);
  return new ProviderError('UNKNOWN', message);
}
