import type { AiErrorCode } from './types.js';

export type ThinkingEffort = 'minimal' | 'low' | 'medium';

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
  system: string;
  prompt: string;
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
  generateJson(req: GenerateJsonRequest): Promise<ProviderResult>;
  generateText(req: GenerateRequest): Promise<ProviderResult>;
}

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
