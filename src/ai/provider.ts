import type { AiErrorCode } from './types.js';

/**
 * Vendor-neutral LLM interface. Everything above this layer (prompts, retries,
 * circuit breaker, validation) is provider-agnostic; swapping Gemini for another
 * vendor means writing one more class that implements this.
 */

/** How much the model may think before answering. Providers map this to their own knob. */
export type ThinkingEffort = 'minimal' | 'low' | 'medium';

/** Small JSON Schema subset understood by every structured-output API we care about. */
export type JsonSchema =
  | { type: 'string'; enum?: readonly string[]; description?: string; maxLength?: number }
  | { type: 'number'; description?: string; minimum?: number; maximum?: number }
  | {
      type: 'object';
      properties: Record<string, JsonSchema>;
      required: readonly string[];
      description?: string;
    };

export interface GenerateRequest {
  model: string;
  /** Stable instructions. Kept byte-identical across calls so prefix caching can apply. */
  system: string;
  /** Per-request content (facts, ticket text). */
  prompt: string;
  /** Hard cap; on Gemini it includes thinking tokens. */
  maxOutputTokens: number;
  thinking: ThinkingEffort;
  signal?: AbortSignal;
}

export interface GenerateJsonRequest extends GenerateRequest {
  schema: JsonSchema;
}

export interface ProviderUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
}

export interface ProviderResult {
  text: string;
  usage: ProviderUsage;
}

export interface AiProvider {
  readonly name: string;
  /** Returns raw JSON text; the caller parses and validates it. */
  generateJson(req: GenerateJsonRequest): Promise<ProviderResult>;
  generateText(req: GenerateRequest): Promise<ProviderResult>;
}

/** The single error type providers throw. `retryable` drives the retry loop. */
export class ProviderError extends Error {
  constructor(
    readonly code: AiErrorCode,
    message: string,
    readonly options: { retryable?: boolean; retryAfterMs?: number; usage?: ProviderUsage } = {},
  ) {
    super(message);
    this.name = 'ProviderError';
  }

  get retryable(): boolean {
    return this.options.retryable ?? false;
  }
}
