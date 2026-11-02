import { PENDING_CATEGORY, PENDING_PRIORITY, type TicketStatus } from '../domain/enums.js';
import { Errors } from '../lib/errors.js';
import type { ClassificationQueue } from '../jobs/classification-queue.js';
import {
  toAdminTicketDto,
  toAuthorTicketDto,
  type AdminTicketDto,
  type AuthorTicketDto,
} from '../mappers/ticket.mapper.js';
import type { TicketDoc } from '../models/ticket.model.js';
import type { BookRepository } from '../repositories/book.repository.js';
import {
  priorityFields,
  statusFields,
  type TicketFilters,
  type TicketRepository,
} from '../repositories/ticket.repository.js';
import type { UserRepository } from '../repositories/user.repository.js';
import type {
  CreateNoteBody,
  CreateReplyBody,
  CreateResponseBody,
  CreateTicketBody,
  ListTicketsQuery,
  UpdateTicketBody,
} from '../schemas/ticket.schema.js';
import type { AuthUser } from '../types/express.js';
import type { NotificationService } from './notification.service.js';

export interface Page<T> {
  data: T[];
  meta: { page: number; limit: number; total: number };
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export class TicketService {
  constructor(
    private readonly tickets: TicketRepository,
    private readonly books: BookRepository,
    private readonly users: UserRepository,
    private readonly classificationQueue: ClassificationQueue,
    private readonly notifications: NotificationService,
  ) {}

  async create(author: AuthUser, body: CreateTicketBody): Promise<AuthorTicketDto> {
    if (!author.authorId) throw Errors.forbidden('Only authors can create tickets');

    if (body.bookId) {
      const book = await this.books.findByBookId(body.bookId);
      if (!book || book.authorId !== author.authorId) {
        throw Errors.validation('Request validation failed', [
          { field: 'bookId', message: 'Select one of your own books' },
        ]);
      }
    }

    const ticketId = await this.tickets.create({
      authorId: author.authorId,
      authorUser: author.id,
      bookId: body.bookId,
      queryType: body.queryType,
      subject: body.subject,
      description: body.description,
      attachments: body.attachments,
    });
    this.classificationQueue.enqueue(ticketId);

    const created = await this.tickets.findForAuthorView(ticketId);
    return toAuthorTicketDto(created!);
  }

  async list(user: AuthUser, query: ListTicketsQuery): Promise<Page<AuthorTicketDto | AdminTicketDto>> {
    const updatedSince = query.updatedSince ? new Date(query.updatedSince) : undefined;
    const meta = { page: query.page, limit: query.limit };

    if (user.role === 'author') {
      const { rows, total } = await this.tickets.listForAuthor({
        filters: { authorId: user.authorId ?? '__none__', authorUpdatedSince: updatedSince },
        ...meta,
      });
      return { data: rows.map(toAuthorTicketDto), meta: { ...meta, total } };
    }

    const { rows, total } = await this.tickets.listForAdmin({
      filters: { ...this.adminFilters(user, query), updatedSince },
      sort: query.sort,
      ...meta,
    });
    return { data: rows.map(toAdminTicketDto), meta: { ...meta, total } };
  }

  async get(user: AuthUser, ticketId: string): Promise<AuthorTicketDto | AdminTicketDto> {
    if (user.role === 'admin') return this.getAdminView(ticketId);

    const ticket = await this.tickets.findForAuthorView(ticketId);
    if (!ticket || ticket.authorId !== user.authorId) throw Errors.notFound('Ticket');
    return toAuthorTicketDto(ticket);
  }

  async reply(author: AuthUser, ticketId: string, body: CreateReplyBody): Promise<AuthorTicketDto> {
    const ticket = await this.tickets.findCore(ticketId);
    if (!ticket || ticket.authorId !== author.authorId) throw Errors.notFound('Ticket');

    const user = await this.users.findById(author.id);
    const added = await this.tickets.addAuthorReply(ticketId, {
      authorName: user?.name ?? 'Author',
      message: body.message,
    });
    if (!added) throw Errors.conflict('This ticket is no longer accepting replies. Please raise a new ticket.');

    const updated = await this.tickets.findForAuthorView(ticketId);
    return toAuthorTicketDto(updated!);
  }

  async update(admin: AuthUser, ticketId: string, body: UpdateTicketBody): Promise<AdminTicketDto> {
    const ticket = await this.requireTicket(ticketId);
    const set: Partial<TicketDoc> = {};

    if (body.status) {
      Object.assign(set, statusFields(body.status, ticket.resolvedAt));
      if (body.status !== ticket.status) set.authorUpdatedAt = new Date();
    }

    if (body.category === null) {
      Object.assign(set, { category: ticket.aiCategory ?? PENDING_CATEGORY, categoryOverridden: false });
    } else if (body.category) {
      Object.assign(set, { category: body.category, categoryOverridden: true });
    }

    if (body.priority === null) {
      Object.assign(set, {
        ...priorityFields(ticket.aiPriority ?? PENDING_PRIORITY),
        priorityOverridden: false,
      });
    } else if (body.priority) {
      Object.assign(set, { ...priorityFields(body.priority), priorityOverridden: true });
    }

    if (body.assignedTo !== undefined) {
      set.assignedTo = (await this.resolveAssignee(admin, body.assignedTo)) as TicketDoc['assignedTo'];
    }

    await this.tickets.update(ticketId, set);
    if (body.status && body.status !== ticket.status) {
      await this.notifications.notifyAuthor(ticket, { type: 'status_change', status: body.status });
    }
    return this.getAdminView(ticketId);
  }

  async respond(admin: AuthUser, ticketId: string, body: CreateResponseBody): Promise<AdminTicketDto> {
    const ticket = await this.requireTicket(ticketId);
    const nextStatus: TicketStatus = body.status ?? (ticket.status === 'Open' ? 'In Progress' : ticket.status);

    await this.tickets.addResponse(
      ticketId,
      {
        admin: admin.id,
        adminName: await this.adminName(admin),
        message: body.message,
        usedAiDraft: body.usedAiDraft,
      },
      { status: nextStatus, currentResolvedAt: ticket.resolvedAt },
    );
    await this.notifications.notifyAuthor(ticket, {
      type: 'reply',
      status: nextStatus === ticket.status ? null : nextStatus,
    });
    return this.getAdminView(ticketId);
  }

  async addNote(admin: AuthUser, ticketId: string, body: CreateNoteBody): Promise<AdminTicketDto> {
    await this.requireTicket(ticketId);
    await this.tickets.addNote(ticketId, {
      admin: admin.id,
      adminName: await this.adminName(admin),
      text: body.text,
    });
    return this.getAdminView(ticketId);
  }

  private async getAdminView(ticketId: string): Promise<AdminTicketDto> {
    const ticket = await this.tickets.findForAdminView(ticketId);
    if (!ticket) throw Errors.notFound('Ticket');
    return toAdminTicketDto(ticket);
  }

  private async requireTicket(ticketId: string) {
    const ticket = await this.tickets.findCore(ticketId);
    if (!ticket) throw Errors.notFound('Ticket');
    return ticket;
  }

  private async adminName(admin: AuthUser): Promise<string> {
    const user = await this.users.findById(admin.id);
    return user?.name ?? 'BookLeaf Support';
  }

  private async resolveAssignee(admin: AuthUser, assignedTo: string | null): Promise<string | null> {
    if (assignedTo === null) return null;
    if (assignedTo === 'me') return admin.id;
    const assignee = await this.users.findAdminById(assignedTo);
    if (!assignee) {
      throw Errors.validation('Request validation failed', [
        { field: 'assignedTo', message: 'Must be the id of an admin user' },
      ]);
    }
    return assignedTo;
  }

  private adminFilters(admin: AuthUser, query: ListTicketsQuery): TicketFilters {
    const filters: TicketFilters = {
      authorId: query.authorId,
      status: query.status,
      category: query.category,
      priority: query.priority,
      search: query.q || undefined,
      needsReply: query.needsReply,
    };
    if (query.assignedTo === 'me') filters.assignedTo = admin.id;
    else if (query.assignedTo === 'unassigned') filters.assignedTo = null;
    else if (query.assignedTo) filters.assignedTo = query.assignedTo;

    if (query.from) filters.createdFrom = new Date(query.from);
    if (query.to) {
      const to = new Date(query.to);
      filters.createdBefore = DATE_ONLY.test(query.to) ? new Date(to.getTime() + ONE_DAY_MS) : to;
    }
    return filters;
  }
}
