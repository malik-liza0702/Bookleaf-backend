import { estimateCostUsd, type AiCallError, type AiUsage } from '../ai/index.js';
import type { AiCallKind } from '../domain/enums.js';
import type { Logger } from '../lib/logger.js';
import type { AiCallLogRepository } from '../repositories/ai-call-log.repository.js';

export class AiCallRecorder {
  constructor(
    private readonly logs: AiCallLogRepository,
    private readonly logger: Logger,
  ) {}

  async record(params: {
    kind: AiCallKind;
    ticketId: string | null;
    model: string;
    usage?: AiUsage;
    error?: Pick<AiCallError, 'code'>;
    elapsedMs: number;
  }): Promise<void> {
    if (params.error?.code === 'NO_API_KEY') return;
    try {
      await this.logs.create({
        ticketId: params.ticketId,
        kind: params.kind,
        model: params.usage?.model ?? params.model,
        inputTokens: params.usage?.inputTokens ?? 0,
        outputTokens: params.usage?.outputTokens ?? 0,
        cacheReadTokens: params.usage?.cacheReadTokens ?? 0,
        estimatedCostUsd: params.usage ? estimateCostUsd(params.usage) : null,
        latencyMs: Math.round(params.usage?.latencyMs ?? params.elapsedMs),
        success: !params.error,
        errorCode: params.error?.code ?? null,
      });
    } catch (err) {
      this.logger.warn({ err, kind: params.kind }, 'Failed to write AI call log');
    }
  }
}
