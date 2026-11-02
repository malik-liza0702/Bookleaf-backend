import {
  formatTicketNumber,
  type AiStatus,
  type QueryType,
  type ResponseSender,
  type TicketCategory,
  type TicketPriority,
  type TicketStatus,
} from '../domain/enums.js';
import type { Attachment, ResponseSubdoc } from '../models/ticket.model.js';
import type { AdminTicketRecord, AuthorTicketRecord } from '../repositories/ticket.repository.js';

const SUPPORT_DISPLAY_NAME = 'BookLeaf Support';

export interface AuthorResponseDto {
  id: string;
  from: ResponseSender;
  message: string;
  authorName: string;
  createdAt: string;
}

export interface AuthorTicketDto {
  id: string;
  ticketNumber: string;
  subject: string;
  description: string;
  status: TicketStatus;
  bookId: string | null;
  bookTitle: string | null;
  queryType: QueryType | null;
  attachments: Attachment[];
  responses: AuthorResponseDto[];
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

export interface AdminResponseDto extends AuthorResponseDto {
  usedAiDraft: boolean;
}

export interface AiDraftDto {
  text: string;
  generatedAt: string;
  model: string;
  fallback: boolean;
  warnings: string[];
}

export interface AdminTicketDto extends Omit<AuthorTicketDto, 'responses'> {
  authorId: string;
  authorName: string;
  authorEmail: string;
  category: TicketCategory;
  priority: TicketPriority;
  aiCategory: TicketCategory | null;
  aiPriority: TicketPriority | null;
  aiReasoning: string | null;
  aiConfidence: number | null;
  categoryOverridden: boolean;
  priorityOverridden: boolean;
  aiStatus: AiStatus;
  assignedTo: { id: string; name: string } | null;
  internalNotes: { id: string; text: string; authorName: string; createdAt: string }[];
  aiDraft: AiDraftDto | null;
  needsReply: boolean;
  responses: AdminResponseDto[];
}

function attachmentsOf(list: Attachment[] | undefined): Attachment[] {
  return (list ?? []).map(({ name, size }) => ({ name, size }));
}

function baseFields(ticket: AuthorTicketRecord) {
  return {
    id: ticket._id.toString(),
    ticketNumber: formatTicketNumber(ticket.number),
    subject: ticket.subject,
    description: ticket.description,
    status: ticket.status,
    bookId: ticket.bookId,
    bookTitle: ticket.book?.title ?? null,
    queryType: ticket.queryType ?? null,
    attachments: attachmentsOf(ticket.attachments),
    createdAt: ticket.createdAt.toISOString(),
    resolvedAt: ticket.resolvedAt?.toISOString() ?? null,
  };
}

function responseFields(response: ResponseSubdoc, supportName: string): AuthorResponseDto {
  const from = response.from ?? 'support';
  return {
    id: response._id.toString(),
    from,
    message: response.message,
    authorName: from === 'author' ? (response.authorName ?? 'Author') : supportName,
    createdAt: response.createdAt.toISOString(),
  };
}

export function toAuthorTicketDto(ticket: AuthorTicketRecord): AuthorTicketDto {
  return {
    ...baseFields(ticket),
    updatedAt: ticket.authorUpdatedAt.toISOString(),
    responses: (ticket.responses ?? []).map((response) => responseFields(response, SUPPORT_DISPLAY_NAME)),
  };
}

export function toAiDraftDto(draft: NonNullable<AdminTicketRecord['aiDraft']>): AiDraftDto {
  return {
    text: draft.text,
    generatedAt: draft.generatedAt.toISOString(),
    model: draft.model,
    fallback: draft.fallback,
    warnings: draft.warnings ?? [],
  };
}

export function toAdminTicketDto(ticket: AdminTicketRecord): AdminTicketDto {
  return {
    ...baseFields(ticket),
    updatedAt: ticket.updatedAt.toISOString(),
    authorId: ticket.authorId,
    authorName: ticket.authorUser?.name ?? 'Unknown author',
    authorEmail: ticket.authorUser?.email ?? '',
    category: ticket.category,
    priority: ticket.priority,
    aiCategory: ticket.aiCategory,
    aiPriority: ticket.aiPriority,
    aiReasoning: ticket.aiReasoning,
    aiConfidence: ticket.aiConfidence,
    categoryOverridden: ticket.categoryOverridden,
    priorityOverridden: ticket.priorityOverridden,
    aiStatus: ticket.aiStatus,
    assignedTo: ticket.assignedTo
      ? { id: ticket.assignedTo._id.toString(), name: ticket.assignedTo.name }
      : null,
    internalNotes: ticket.internalNotes.map((note) => ({
      id: note._id.toString(),
      text: note.text,
      authorName: note.adminName,
      createdAt: note.createdAt.toISOString(),
    })),
    aiDraft: ticket.aiDraft ? toAiDraftDto(ticket.aiDraft) : null,
    needsReply: ticket.needsReply ?? false,
    responses: ticket.responses.map((response) => ({
      ...responseFields(response, response.adminName ?? SUPPORT_DISPLAY_NAME),
      usedAiDraft: response.usedAiDraft,
    })),
  };
}
