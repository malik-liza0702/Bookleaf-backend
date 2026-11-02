import { Schema, model, type Types } from 'mongoose';
import { AI_CALL_KINDS, type AiCallKind } from '../domain/enums.js';

export interface AiCallLogDoc {
  _id: Types.ObjectId;
  ticketId: Types.ObjectId | null;
  kind: AiCallKind;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  estimatedCostUsd: number | null;
  latencyMs: number;
  success: boolean;
  errorCode: string | null;
  createdAt: Date;
}

const aiCallLogSchema = new Schema<AiCallLogDoc>(
  {
    ticketId: { type: Schema.Types.ObjectId, ref: 'Ticket', default: null },
    kind: { type: String, enum: AI_CALL_KINDS, required: true },
    model: { type: String, required: true },
    inputTokens: { type: Number, default: 0 },
    outputTokens: { type: Number, default: 0 },
    cacheReadTokens: { type: Number, default: 0 },
    estimatedCostUsd: { type: Number, default: null },
    latencyMs: { type: Number, required: true },
    success: { type: Boolean, required: true },
    errorCode: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

aiCallLogSchema.index({ createdAt: -1 });
aiCallLogSchema.index({ ticketId: 1 });
aiCallLogSchema.index({ kind: 1, createdAt: -1 });

export const AiCallLogModel = model<AiCallLogDoc>('AiCallLog', aiCallLogSchema);
