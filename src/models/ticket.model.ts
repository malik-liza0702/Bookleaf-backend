import { Schema, model, type Types } from 'mongoose';
import {
  AI_STATUSES,
  QUERY_TYPES,
  RESPONSE_SENDERS,
  TICKET_CATEGORIES,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  PENDING_CATEGORY,
  PENDING_PRIORITY,
  type AiStatus,
  type QueryType,
  type ResponseSender,
  type TicketCategory,
  type TicketPriority,
  type TicketStatus,
} from '../domain/enums.js';

export interface ResponseSubdoc {
  _id: Types.ObjectId;
  from?: ResponseSender;
  admin?: Types.ObjectId;
  adminName?: string;
  authorName?: string;
  message: string;
  usedAiDraft: boolean;
  createdAt: Date;
}

export interface NoteSubdoc {
  _id: Types.ObjectId;
  admin: Types.ObjectId;
  adminName: string;
  text: string;
  createdAt: Date;
}

export interface AiDraftSubdoc {
  text: string;
  model: string;
  fallback: boolean;
  warnings: string[];
  generatedAt: Date;
}

export interface Attachment {
  name: string;
  size: number;
}

export interface TicketDoc {
  _id: Types.ObjectId;
  number: number;
  authorId: string;
  authorUser: Types.ObjectId;
  bookId: string | null;
  queryType: QueryType | null;
  subject: string;
  description: string;
  attachments: Attachment[];

  status: TicketStatus;
  resolvedAt: Date | null;

  category: TicketCategory;
  priority: TicketPriority;
  categoryOverridden: boolean;
  priorityOverridden: boolean;

  aiStatus: AiStatus;
  aiCategory: TicketCategory | null;
  aiPriority: TicketPriority | null;
  aiReasoning: string | null;
  aiConfidence: number | null;

  statusRank: number;
  priorityRank: number;

  assignedTo: Types.ObjectId | null;
  responses: ResponseSubdoc[];
  internalNotes: NoteSubdoc[];
  aiDraft: AiDraftSubdoc | null;
  needsReply: boolean;

  authorUpdatedAt: Date;

  createdAt: Date;
  updatedAt: Date;
}

const responseSchema = new Schema<ResponseSubdoc>(
  {
    from: { type: String, enum: RESPONSE_SENDERS, default: 'support' },
    admin: { type: Schema.Types.ObjectId, ref: 'User' },
    adminName: { type: String },
    authorName: { type: String },
    message: { type: String, required: true },
    usedAiDraft: { type: Boolean, default: false },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

const noteSchema = new Schema<NoteSubdoc>(
  {
    admin: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    adminName: { type: String, required: true },
    text: { type: String, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

const aiDraftSchema = new Schema<AiDraftSubdoc>(
  {
    text: { type: String, required: true },
    model: { type: String, required: true },
    fallback: { type: Boolean, default: false },
    warnings: { type: [String], default: [] },
    generatedAt: { type: Date, required: true },
  },
  { _id: false },
);

const ticketSchema = new Schema<TicketDoc>(
  {
    number: { type: Number, required: true, unique: true },
    authorId: { type: String, required: true },
    authorUser: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    bookId: { type: String, default: null },
    queryType: { type: String, enum: QUERY_TYPES, default: null },
    subject: { type: String, required: true, maxlength: 150 },
    description: { type: String, required: true, maxlength: 5000 },
    attachments: {
      type: [new Schema<Attachment>({ name: String, size: Number }, { _id: false })],
      default: [],
    },

    status: { type: String, enum: TICKET_STATUSES, default: 'Open' },
    resolvedAt: { type: Date, default: null },

    category: { type: String, enum: TICKET_CATEGORIES, default: PENDING_CATEGORY },
    priority: { type: String, enum: TICKET_PRIORITIES, default: PENDING_PRIORITY },
    categoryOverridden: { type: Boolean, default: false },
    priorityOverridden: { type: Boolean, default: false },

    aiStatus: { type: String, enum: AI_STATUSES, default: 'pending' },
    aiCategory: { type: String, enum: [...TICKET_CATEGORIES, null], default: null },
    aiPriority: { type: String, enum: [...TICKET_PRIORITIES, null], default: null },
    aiReasoning: { type: String, default: null },
    aiConfidence: { type: Number, default: null, min: 0, max: 1 },

    statusRank: { type: Number, required: true },
    priorityRank: { type: Number, required: true },

    assignedTo: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    responses: { type: [responseSchema], default: [] },
    internalNotes: { type: [noteSchema], default: [] },
    aiDraft: { type: aiDraftSchema, default: null },
    needsReply: { type: Boolean, default: false },
    authorUpdatedAt: { type: Date, required: true },
  },
  {
    timestamps: true,
    toJSON: { virtuals: false },
  },
);

ticketSchema.virtual('book', {
  ref: 'Book',
  localField: 'bookId',
  foreignField: 'bookId',
  justOne: true,
});

ticketSchema.index({ statusRank: 1, priorityRank: 1, createdAt: 1 });
ticketSchema.index({ status: 1, priority: 1, createdAt: 1 });
ticketSchema.index({ authorId: 1, authorUpdatedAt: -1 });
ticketSchema.index({ updatedAt: 1 });
ticketSchema.index({ createdAt: -1 });
ticketSchema.index({ assignedTo: 1 });
ticketSchema.index({ needsReply: 1 });
ticketSchema.index({ aiStatus: 1 });

export const TicketModel = model<TicketDoc>('Ticket', ticketSchema);
