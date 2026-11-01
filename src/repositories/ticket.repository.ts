import { isValidObjectId, type QueryFilter, type SortOrder, type Types, type UpdateQuery } from 'mongoose';
import {
  priorityRank,
  statusRank,
  type AiStatus,
  type TicketCategory,
  type TicketPriority,
  type TicketStatus,
} from '../domain/enums.js';
import { escapeRegex } from '../lib/regex.js';
import { nextSequence } from '../models/counter.model.js';
import type { BookDoc } from '../models/book.model.js';
import {
  TicketModel,
  type AiDraftSubdoc,
  type Attachment,
  type TicketDoc,
} from '../models/ticket.model.js';

/** Fields an author may ever see. AI fields, notes, drafts and assignee are never loaded. */
const AUTHOR_VIEW_FIELDS =
  'number authorId bookId queryType subject description attachments status responses resolvedAt createdAt authorUpdatedAt';

export type AuthorTicketRecord = Pick<
  TicketDoc,
  | '_id'
  | 'number'
  | 'authorId'
  | 'bookId'
  | 'queryType'
  | 'subject'
  | 'description'
  | 'attachments'
  | 'status'
  | 'responses'
  | 'resolvedAt'
  | 'createdAt'
  | 'authorUpdatedAt'
> & { book?: { title: string } | null };

export type AdminTicketRecord = Omit<TicketDoc, 'authorUser' | 'assignedTo'> & {
  authorUser: { _id: Types.ObjectId; name: string; email: string } | null;
  assignedTo: { _id: Types.ObjectId; name: string } | null;
  book?: { title: string } | null;
};

/** What the AI draft needs: no internal notes, only the last few responses. */
export type DraftContextRecord = Omit<TicketDoc, 'authorUser' | 'internalNotes'> & {
  authorUser: { _id: Types.ObjectId; name: string } | null;
  book?: BookDoc | null;
};

export type ClassificationRecord = Pick<TicketDoc, '_id' | 'subject' | 'description' | 'aiStatus'> & {
  book?: BookDoc | null;
};

export interface TicketFilters {
  authorId?: string;
  status?: TicketStatus;
  category?: TicketCategory;
  priority?: TicketPriority;
  /** A user id, or null for "unassigned". */
  assignedTo?: string | null;
  createdFrom?: Date;
  createdBefore?: Date;
  search?: string;
  needsReply?: boolean;
  updatedSince?: Date;
  authorUpdatedSince?: Date;
}

export type TicketSort = 'urgency' | 'newest' | 'oldest';

const SORTS: Record<TicketSort, Record<string, SortOrder>> = {
  // Unresolved first, then Critical > High > Medium > Low, then oldest first
  // so long-waiting tickets surface. Served by the matching compound index.
  urgency: { statusRank: 1, priorityRank: 1, createdAt: 1, _id: 1 },
  newest: { createdAt: -1, _id: -1 },
  oldest: { createdAt: 1, _id: 1 },
};

const AUTHOR_SORT: Record<string, SortOrder> = { authorUpdatedAt: -1, _id: -1 };

const DRAFT_THREAD_LIMIT = 6;

/** Keeps the embedded thread bounded: past this an author is asked to raise a new ticket. */
const MAX_THREAD_MESSAGES = 50;

/** Status-dependent fields that must always change together. */
export function statusFields(status: TicketStatus, currentResolvedAt: Date | null) {
  const rank = statusRank(status);
  return {
    status,
    statusRank: rank,
    resolvedAt: rank === 0 ? null : (currentResolvedAt ?? new Date()),
    // A finished ticket is not waiting for anyone.
    ...(rank === 0 ? {} : { needsReply: false }),
  };
}

export function priorityFields(priority: TicketPriority) {
  return { priority, priorityRank: priorityRank(priority) };
}

/**
 * All ticket reads and writes go through here, so the derived sort keys
 * (statusRank, priorityRank) and updatedAt can never drift from the data.
 * Malformed ids resolve to null (the service turns that into 404) instead of
 * surfacing a Mongoose CastError.
 */
export class TicketRepository {
  private buildQuery(filters: TicketFilters): QueryFilter<TicketDoc> {
    const query: QueryFilter<TicketDoc> = {};
    if (filters.authorId) query.authorId = filters.authorId;
    if (filters.status) query.status = filters.status;
    if (filters.category) query.category = filters.category;
    if (filters.priority) query.priority = filters.priority;
    if (filters.assignedTo !== undefined) query.assignedTo = filters.assignedTo;
    if (filters.needsReply !== undefined) query.needsReply = filters.needsReply ? true : { $ne: true };
    if (filters.createdFrom || filters.createdBefore) {
      query.createdAt = {
        ...(filters.createdFrom ? { $gte: filters.createdFrom } : {}),
        ...(filters.createdBefore ? { $lt: filters.createdBefore } : {}),
      };
    }
    if (filters.updatedSince) query.updatedAt = { $gt: filters.updatedSince };
    if (filters.authorUpdatedSince) query.authorUpdatedAt = { $gt: filters.authorUpdatedSince };
    if (filters.search) {
      // "TKT-0007" or "7" jumps to a ticket number; anything else searches the
      // subject. User input is escaped so it is matched literally.
      const numberMatch = /^(?:tkt-?)?0*(\d+)$/i.exec(filters.search);
      const subjectMatch = { subject: { $regex: escapeRegex(filters.search), $options: 'i' } };
      query.$or = numberMatch ? [subjectMatch, { number: Number(numberMatch[1]) }] : [subjectMatch];
    }
    return query;
  }

  async listForAuthor(params: { filters: TicketFilters; page: number; limit: number }) {
    const query = this.buildQuery(params.filters);
    const [rows, total] = await Promise.all([
      TicketModel.find(query)
        .select(AUTHOR_VIEW_FIELDS)
        .sort(AUTHOR_SORT)
        .skip((params.page - 1) * params.limit)
        .limit(params.limit)
        .populate('book', 'title')
        .lean<AuthorTicketRecord[]>(),
      TicketModel.countDocuments(query),
    ]);
    return { rows, total };
  }

  async listForAdmin(params: { filters: TicketFilters; sort: TicketSort; page: number; limit: number }) {
    const query = this.buildQuery(params.filters);
    const [rows, total] = await Promise.all([
      this.adminQuery(TicketModel.find(query))
        .sort(SORTS[params.sort])
        .skip((params.page - 1) * params.limit)
        .limit(params.limit)
        .lean<AdminTicketRecord[]>(),
      TicketModel.countDocuments(query),
    ]);
    return { rows, total };
  }

  private adminQuery<Q extends ReturnType<typeof TicketModel.find> | ReturnType<typeof TicketModel.findOne>>(
    query: Q,
  ): Q {
    return query
      .populate('authorUser', 'name email')
      .populate('assignedTo', 'name')
      .populate('book', 'title') as Q;
  }

  findForAuthorView(id: string) {
    if (!isValidObjectId(id)) return Promise.resolve(null);
    return TicketModel.findById(id)
      .select(AUTHOR_VIEW_FIELDS)
      .populate('book', 'title')
      .lean<AuthorTicketRecord>();
  }

  findForAdminView(id: string) {
    if (!isValidObjectId(id)) return Promise.resolve(null);
    return this.adminQuery(TicketModel.findOne({ _id: id })).lean<AdminTicketRecord>();
  }

  findForDraft(id: string) {
    if (!isValidObjectId(id)) return Promise.resolve(null);
    return TicketModel.findById(id)
      .select({ internalNotes: 0, responses: { $slice: -DRAFT_THREAD_LIMIT } })
      .populate('authorUser', 'name')
      .populate('book')
      .lean<DraftContextRecord>();
  }

  findForClassification(id: string) {
    return TicketModel.findById(id)
      .select('subject description bookId aiStatus')
      .populate('book')
      .lean<ClassificationRecord>();
  }

  findCore(id: string) {
    if (!isValidObjectId(id)) return Promise.resolve(null);
    return TicketModel.findById(id).select('-responses -internalNotes -aiDraft').lean<TicketDoc>();
  }

  async create(data: {
    authorId: string;
    authorUser: string;
    bookId: string | null;
    queryType: TicketDoc['queryType'];
    subject: string;
    description: string;
    attachments: Attachment[];
  }): Promise<string> {
    const number = await nextSequence('ticketNumber');
    const ticket = await TicketModel.create({
      ...data,
      number,
      ...statusFields('Open', null),
      ...priorityFields('Medium'),
      authorUpdatedAt: new Date(),
    });
    return ticket._id.toString();
  }

  /** Applies a $set (and optional $unset). timestamps: true bumps updatedAt. */
  async update(id: string, set: Partial<TicketDoc>): Promise<boolean> {
    const result = await TicketModel.updateOne({ _id: id }, { $set: set });
    return result.matchedCount === 1;
  }

  /**
   * Stores a classification in ONE atomic update. The effective category and
   * priority only change when the admin has not overridden them; the check
   * happens inside the update pipeline, so an override that lands while the
   * model is running is never clobbered.
   */
  async saveClassification(
    id: string,
    result: {
      aiStatus: AiStatus;
      category: TicketCategory;
      priority: TicketPriority;
      reasoning: string;
      confidence: number | null;
    },
  ) {
    // $literal stops a value that happens to start with "$" being read as a field path.
    const lit = <T>(value: T) => ({ $literal: value });
    await TicketModel.updateOne({ _id: id }, [
      {
        $set: {
          aiStatus: lit(result.aiStatus),
          aiCategory: lit(result.category),
          aiPriority: lit(result.priority),
          aiReasoning: lit(result.reasoning),
          aiConfidence: lit(result.confidence),
          category: { $cond: ['$categoryOverridden', '$category', lit(result.category)] },
          priority: { $cond: ['$priorityOverridden', '$priority', lit(result.priority)] },
          priorityRank: {
            $cond: ['$priorityOverridden', '$priorityRank', lit(priorityRank(result.priority))],
          },
          updatedAt: '$$NOW',
        },
      },
    ], { updatePipeline: true });
  }

  /**
   * Appends a public response and applies the new status atomically, and drops
   * the cached AI draft (it no longer reflects the thread).
   */
  async addResponse(
    id: string,
    response: { admin: string; adminName: string; message: string; usedAiDraft: boolean },
    status: { status: TicketStatus; currentResolvedAt: Date | null },
  ): Promise<boolean> {
    const update: UpdateQuery<TicketDoc> = {
      $push: { responses: response },
      $set: {
        ...statusFields(status.status, status.currentResolvedAt),
        needsReply: false,
        aiDraft: null,
        authorUpdatedAt: new Date(),
      },
    };
    const result = await TicketModel.updateOne({ _id: id }, update);
    return result.matchedCount === 1;
  }

  /**
   * Appends an author's follow-up and flags the ticket for support, unless it has
   * reached a final stage or the thread is full (returns false). Both checks are
   * in the update filter, so a reply racing an admin resolving the ticket can't
   * slip in. Drops the cached AI draft, which was written before this message.
   */
  async addAuthorReply(id: string, reply: { authorName: string; message: string }): Promise<boolean> {
    const result = await TicketModel.updateOne(
      { _id: id, statusRank: 0, [`responses.${MAX_THREAD_MESSAGES - 1}`]: { $exists: false } },
      {
        $push: { responses: { ...reply, from: 'author' } },
        $set: { needsReply: true, aiDraft: null, authorUpdatedAt: new Date() },
      },
    );
    return result.matchedCount === 1;
  }

  async addNote(id: string, note: { admin: string; adminName: string; text: string }): Promise<boolean> {
    const result = await TicketModel.updateOne({ _id: id }, { $push: { internalNotes: note } });
    return result.matchedCount === 1;
  }

  /**
   * Caches the draft without bumping updatedAt: drafts are admin-only, so
   * generating one should not make every author/admin poll refetch.
   */
  async saveDraft(id: string, draft: AiDraftSubdoc) {
    await TicketModel.updateOne({ _id: id }, { $set: { aiDraft: draft } }, { timestamps: false });
  }

  /**
   * Fills authorUpdatedAt on tickets created before the field existed, from the
   * latest of creation, last reply and resolution. Safe to run on every boot.
   */
  async backfillAuthorUpdatedAt(): Promise<number> {
    const result = await TicketModel.updateMany(
      { authorUpdatedAt: { $exists: false } },
      [{ $set: { authorUpdatedAt: { $max: ['$createdAt', '$resolvedAt', { $max: '$responses.createdAt' }] } } }],
      { updatePipeline: true, timestamps: false },
    );
    return result.modifiedCount;
  }

  async findPendingClassificationIds(): Promise<string[]> {
    const rows = await TicketModel.find({ aiStatus: 'pending' })
      .select('_id')
      .sort({ createdAt: 1 })
      .lean();
    return rows.map((row) => row._id.toString());
  }

  /** Ticket counts for each of these authors; authors without tickets are simply absent. */
  countsByAuthor(authorIds: string[]) {
    return TicketModel.aggregate<{ _id: string; total: number; unresolved: number }>([
      { $match: { authorId: { $in: authorIds } } },
      {
        $group: {
          _id: '$authorId',
          total: { $sum: 1 },
          unresolved: { $sum: { $cond: [{ $eq: ['$statusRank', 0] }, 1, 0] } },
        },
      },
    ]);
  }

  async stats() {
    const unresolved = { statusRank: 0 };
    const [byStatus, critical, unassigned, oldestOpen] = await Promise.all([
      TicketModel.aggregate<{ _id: TicketStatus; count: number }>([
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      TicketModel.countDocuments({ ...unresolved, priority: 'Critical' }),
      TicketModel.countDocuments({ ...unresolved, assignedTo: null }),
      TicketModel.findOne(unresolved).sort({ createdAt: 1 }).select('createdAt').lean(),
    ]);
    const countFor = (status: TicketStatus) => byStatus.find((row) => row._id === status)?.count ?? 0;
    return { countFor, critical, unassigned, oldestOpenAt: oldestOpen?.createdAt ?? null };
  }
}
