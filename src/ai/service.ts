import { classifyTicket } from './classifier.js';
import { CircuitBreaker } from './circuitBreaker.js';
import { DRAFT_UNAVAILABLE_MESSAGE, generateDraft } from './draftGenerator.js';
import { GeminiProvider } from './geminiProvider.js';
import { ModelCaller } from './modelCaller.js';
import type { AiProvider } from './provider.js';
import { classifyByRules } from './rulesClassifier.js';
import { AiUnavailableError, type AiConfig, type AiService } from './types.js';

export interface AiServiceDeps {
  /** Replaces the Gemini provider (tests, or another vendor). */
  provider?: AiProvider;
  /** Test hooks. */
  sleep?: (ms: number) => Promise<void>;
  clock?: () => number;
  breaker?: { failureThreshold?: number; cooldownMs?: number };
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RETRIES = 2;

/**
 * Builds the AI service. Without an API key (and no injected provider) it runs
 * in disabled mode: classification uses the rules classifier and drafts throw
 * AiUnavailableError('NO_API_KEY') immediately, so the app still works end to end.
 */
export function createAiService(config: AiConfig, deps: AiServiceDeps = {}): AiService {
  const apiKey = config.apiKey?.trim();
  const provider = deps.provider ?? (apiKey ? new GeminiProvider(apiKey) : null);

  if (!provider) {
    return {
      enabled: false,
      classifyTicket: async (input) => ({
        ...classifyByRules(input),
        error: { code: 'NO_API_KEY', message: 'GEMINI_API_KEY is not set; used rule-based classification' },
      }),
      generateDraft: async () => {
        throw new AiUnavailableError('NO_API_KEY', DRAFT_UNAVAILABLE_MESSAGE);
      },
    };
  }

  const clock = deps.clock ?? Date.now;
  // One breaker for the provider: classification and drafts hit the same API and quota.
  const breaker = new CircuitBreaker(deps.breaker?.failureThreshold ?? 5, deps.breaker?.cooldownMs ?? 60_000, clock);
  const caller = new ModelCaller(
    provider,
    breaker,
    {
      timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxRetries: config.maxRetries ?? DEFAULT_MAX_RETRIES,
      ...(deps.sleep ? { sleep: deps.sleep } : {}),
    },
    clock,
  );

  return {
    enabled: true,
    classifyTicket: (input) => classifyTicket(caller, config.classifyModel, input),
    generateDraft: (input) => generateDraft(caller, config.draftModel, input),
  };
}
