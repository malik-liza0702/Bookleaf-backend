import type { AiCallKind } from '../domain/enums.js';
import { AiCallLogModel } from '../models/ai-call-log.model.js';

export interface AiCallLogEntry {
  ticketId: string | null;
  kind: AiCallKind;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  estimatedCostUsd: number | null;
  latencyMs: number;
  success: boolean;
  errorCode: string | null;
}

export interface AiUsageRow {
  kind: AiCallKind;
  model: string;
  calls: number;
  failures: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  estimatedCostUsd: number;
  avgLatencyMs: number;
}

export class AiCallLogRepository {
  async create(entry: AiCallLogEntry): Promise<void> {
    await AiCallLogModel.create(entry);
  }

  /** Per kind and model since `since`: calls, failures, token totals, average latency. */
  summarize(since: Date): Promise<AiUsageRow[]> {
    return AiCallLogModel.aggregate<AiUsageRow>([
      { $match: { createdAt: { $gte: since } } },
      {
        $group: {
          _id: { kind: '$kind', model: '$model' },
          calls: { $sum: 1 },
          failures: { $sum: { $cond: ['$success', 0, 1] } },
          inputTokens: { $sum: '$inputTokens' },
          outputTokens: { $sum: '$outputTokens' },
          cacheReadTokens: { $sum: '$cacheReadTokens' },
          estimatedCostUsd: { $sum: { $ifNull: ['$estimatedCostUsd', 0] } },
          avgLatencyMs: { $avg: '$latencyMs' },
        },
      },
      {
        $project: {
          _id: 0,
          kind: '$_id.kind',
          model: '$_id.model',
          calls: 1,
          failures: 1,
          inputTokens: 1,
          outputTokens: 1,
          cacheReadTokens: 1,
          estimatedCostUsd: { $round: ['$estimatedCostUsd', 6] },
          avgLatencyMs: { $round: ['$avgLatencyMs', 0] },
        },
      },
      { $sort: { kind: 1, model: 1 } },
    ]);
  }
}
