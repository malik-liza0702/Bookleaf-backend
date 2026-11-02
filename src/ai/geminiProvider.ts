import {
  ApiError,
  FinishReason,
  GoogleGenAI,
  ThinkingLevel,
  type GenerateContentConfig,
  type GenerateContentResponse,
  type ThinkingConfig,
} from '@google/genai';
import {
  ProviderError,
  type AiProvider,
  type GenerateJsonRequest,
  type GenerateRequest,
  type ProviderResult,
  type ProviderUsage,
  type ThinkingEffort,
} from './provider.js';

export class GeminiProvider implements AiProvider {
  readonly name = 'gemini';
  private readonly client: GoogleGenAI;

  constructor(private readonly apiKey: string) {
    this.client = new GoogleGenAI({ apiKey });
  }

  generateJson(req: GenerateJsonRequest): Promise<ProviderResult> {
    return this.call(req, { responseMimeType: 'application/json', responseJsonSchema: req.schema });
  }

  generateText(req: GenerateRequest): Promise<ProviderResult> {
    return this.call(req, { responseMimeType: 'text/plain' });
  }

  private async call(req: GenerateRequest, extra: GenerateContentConfig): Promise<ProviderResult> {
    let response: GenerateContentResponse;
    try {
      response = await this.client.models.generateContent({
        model: req.model,
        contents: [{ role: 'user', parts: [{ text: req.prompt }] }],
        config: {
          ...extra,
          systemInstruction: req.system,
          maxOutputTokens: req.maxOutputTokens,
          thinkingConfig: thinkingConfigFor(req.model, req.thinking),
          abortSignal: req.signal,
        },
      });
    } catch (err) {
      throw this.mapError(err);
    }
    return readResponse(response);
  }

  private mapError(err: unknown): ProviderError {
    const raw = err instanceof Error ? err.message : String(err);
    const message = scrub(raw, this.apiKey);

    if (err instanceof ApiError) {
      const status = err.status;
      if (status === 429) {
        return new ProviderError('RATE_LIMITED', `Gemini rate limit (429): ${message}`, {
          retryable: true,
          retryAfterMs: parseRetryDelayMs(raw),
        });
      }
      if (status === 408) return new ProviderError('TIMEOUT', `Gemini timeout (408): ${message}`, { retryable: true });
      if (status >= 500) {
        return new ProviderError('UNAVAILABLE', `Gemini unavailable (${status}): ${message}`, { retryable: true });
      }
      if (status === 401 || status === 403) {
        return new ProviderError('UNKNOWN', `Gemini rejected the API key (${status}). Check GEMINI_API_KEY.`);
      }
      return new ProviderError('UNKNOWN', `Gemini request failed (${status}): ${message}`);
    }
    if (err instanceof Error && err.name === 'AbortError') {
      return new ProviderError('TIMEOUT', 'Gemini request aborted (timeout)', { retryable: true });
    }
    return new ProviderError('UNAVAILABLE', `Gemini network error: ${message}`, { retryable: true });
  }
}

function readResponse(response: GenerateContentResponse): ProviderResult {
  const usage = readUsage(response);
  const blockReason = response.promptFeedback?.blockReason;
  if (blockReason) {
    throw new ProviderError('BLOCKED', `Gemini blocked the prompt (${blockReason})`, { usage });
  }

  const candidate = response.candidates?.[0];
  const finishReason = candidate?.finishReason;
  if (finishReason !== FinishReason.STOP) {
    const code = finishReason === FinishReason.MAX_TOKENS || !finishReason ? 'INVALID_OUTPUT' : 'BLOCKED';
    throw new ProviderError(code, `Gemini stopped with finishReason=${finishReason ?? 'none'}`, { usage });
  }

  const text = response.text?.trim() ?? '';
  if (!text) throw new ProviderError('INVALID_OUTPUT', 'Gemini returned an empty response', { usage });
  return { text, usage };
}

function readUsage(response: GenerateContentResponse): ProviderUsage {
  const meta = response.usageMetadata;
  return {
    inputTokens: meta?.promptTokenCount ?? 0,
    outputTokens: (meta?.candidatesTokenCount ?? 0) + (meta?.thoughtsTokenCount ?? 0),
    cacheReadTokens: meta?.cachedContentTokenCount ?? 0,
  };
}

export function thinkingConfigFor(model: string, effort: ThinkingEffort): ThinkingConfig {
  if (/^gemini-2\./.test(model)) {
    const budget = { minimal: 0, low: 512, medium: -1 }[effort];
    return { thinkingBudget: budget };
  }
  const supportsMinimal = !/^gemini-3\.\d+-flash$/.test(model);
  const level = {
    minimal: supportsMinimal ? ThinkingLevel.MINIMAL : ThinkingLevel.LOW,
    low: ThinkingLevel.LOW,
    medium: ThinkingLevel.MEDIUM,
  }[effort];
  return { thinkingLevel: level };
}

export function parseRetryDelayMs(message: string): number | undefined {
  const match = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(message);
  return match?.[1] ? Math.ceil(Number(match[1]) * 1000) : undefined;
}

function scrub(message: string, secret: string): string {
  const cleaned = secret ? message.split(secret).join('[redacted]') : message;
  return cleaned.length > 300 ? `${cleaned.slice(0, 300)}…` : cleaned;
}
