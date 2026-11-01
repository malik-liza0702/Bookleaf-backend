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

/**
 * Responses, internal notes and the cached AI draft are embedded in the ticket:
 * they are small, bounded per ticket, always read together with it, and never
 * queried on their own. Embedding also makes "append a response + change the
 * status" a single atomic update, with no multi-document transaction.
 *
 * The sender's name is copied into each response/note (like an email "From"
 * line) so rendering a thread needs no extra lookups.
 */
export interface ResponseSubdoc {
  _id: Types.ObjectId;
  /** Missing on replies stored before authors could reply; those are all from support. */
  from?: ResponseSender;
  admin?: Types.ObjectId; // support replies only
  adminName?: string; // support replies only
  authorName?: string; // author replies only
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
  /** Things to double-check before sending (e.g. an amount not in the book record). */
  warnings: string[];
  generatedAt: Date;
}

export interface Attachment {
  name: string;
  size: number;
}

export interface TicketDoc {
  _id: Types.ObjectId;
  number: number; // rendered as TKT-0001
  authorId: string; // AUTH001
  authorUser: Types.ObjectId; // the author's User, for name/email
  bookId: string | null; // BK001
  queryType: QueryType | null; // null on tickets raised before the field existed
  subject: string;
  description: string;
  attachments: Attachment[];

  status: TicketStatus;
  resolvedAt: Date | null;

  // Effective values: the AI (or rules) value unless an admin overrode them.
  category: TicketCategory;
  priority: TicketPriority;
  categoryOverridden: boolean;
  priorityOverridden: boolean;

  aiStatus: AiStatus;
  aiCategory: TicketCategory | null;
  aiPriority: TicketPriority | null;
  aiReasoning: string | null;
  aiConfidence: number | null;

  // Stored sort keys for the "urgency" sort, kept in sync with status/priority
  // by the repository. Lets MongoDB serve that sort straight from an index.
  statusRank: number;
  priorityRank: number;

  assignedTo: Types.ObjectId | null;
  responses: ResponseSubdoc[];
  internalNotes: NoteSubdoc[];
  aiDraft: AiDraftSubdoc | null;
  // The author's follow-up is waiting for an answer. New tickets show up as Open instead.
  needsReply: boolean;

  // Last change the author can see: creation, a reply or a status change. Admin
  // work (notes, assignment, category, priority, classification) leaves it alone.
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
    // createdAt/updatedAt maintained by Mongoose on create AND on every
    // update query ($set/$push alike), which the polling endpoints rely on.
    timestamps: true,
    toJSON: { virtuals: false },
  },
);

// Book title is looked up by business key when rendering a ticket.
ticketSchema.virtual('book', {
  ref: 'Book',
  localField: 'bookId',
  foreignField: 'bookId',
  justOne: true,
});

ticketSchema.index({ statusRank: 1, priorityRank: 1, createdAt: 1 }); // urgency sort
ticketSchema.index({ status: 1, priority: 1, createdAt: 1 }); // admin filters
ticketSchema.index({ authorId: 1, authorUpdatedAt: -1 }); // author's list, newest visible update first
ticketSchema.index({ updatedAt: 1 }); // ?updatedSince= polling
ticketSchema.index({ createdAt: -1 }); // newest/oldest sorts, date range
ticketSchema.index({ assignedTo: 1 });
ticketSchema.index({ needsReply: 1 }); // admin filter
ticketSchema.index({ aiStatus: 1 }); // re-queue pending classifications on boot

export const TicketModel = model<TicketDoc>('Ticket', ticketSchema);
