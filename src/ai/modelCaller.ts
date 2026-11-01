import type { CircuitBreaker } from './circuitBreaker.js';
import {
  ProviderError,
  type AiProvider,
  type GenerateJsonRequest,
  type GenerateRequest,
  type ProviderUsage,
} from './provider.js';
import { withRetry, type RetryOptions } from './retry.js';
import type { AiErrorCode, AiUsage } from './types.js';

/** Codes that say the provider itself is unhealthy; only these trip the circuit breaker. */
const HEALTH_FAILURES: ReadonlySet<AiErrorCode> = new Set(['RATE_LIMITED', 'UNAVAILABLE', 'TIMEOUT', 'UNKNOWN']);

export class ModelCallError extends Error {
  constructor(
    readonly code: AiErrorCode,
    message: string,
    /** Tokens were still spent when the model answered but the answer was unusable. */
    readonly usage?: AiUsage,
  ) {
    super(message);
    this.name = 'ModelCallError';
  }
}

export interface ModelCallResult {
  text: string;
  usage: AiUsage;
}

type Request = Omit<GenerateRequest, 'signal'> & { schema?: GenerateJsonRequest['schema'] };

/**
 * The one path every model call takes: circuit breaker → per-attempt timeout
 * and retries → usage accounting → error normalisation.
 */
export class ModelCaller {
  constructor(
    private readonly provider: AiProvider,
    private readonly breaker: CircuitBreaker,
    private readonly retry: RetryOptions,
    private readonly clock: () => number = Date.now,
  ) {}

  async run(req: Request): Promise<ModelCallResult> {
    if (!this.breaker.allowRequest()) {
      throw new ModelCallError('UNAVAILABLE', 'AI temporarily paused after repeated provider failures (circuit open)');
    }
    const started = this.clock();
    try {
      const result = await withRetry((signal) => {
        const { schema, ...rest } = req;
        return schema
          ? this.provider.generateJson({ ...rest, schema, signal })
          : this.provider.generateText({ ...rest, signal });
      }, this.retry);
      this.breaker.recordSuccess();
      return { text: result.text, usage: toUsage(req.model, result.usage, this.clock() - started) };
    } catch (err) {
      const error = err instanceof ProviderError ? err : new ProviderError('UNKNOWN', String(err));
      // A blocked or malformed answer means the provider is up; don't count it against its health.
      if (HEALTH_FAILURES.has(error.code)) this.breaker.recordFailure();
      else this.breaker.recordSuccess();
      const usage = error.options.usage ? toUsage(req.model, error.options.usage, this.clock() - started) : undefined;
      throw new ModelCallError(error.code, error.message, usage);
    }
  }
}

function toUsage(model: string, usage: ProviderUsage, latencyMs: number): AiUsage {
  return { model, ...usage, latencyMs };
}

/** Sums usage across attempts of one logical task (e.g. a retry after invalid JSON). */
export function addUsage(a: AiUsage | undefined, b: AiUsage | undefined): AiUsage | undefined {
  if (!a) return b;
  if (!b) return a;
  return {
    model: b.model,
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    latencyMs: a.latencyMs + b.latencyMs,
  };
}
