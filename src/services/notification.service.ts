import type { Logger } from '../lib/logger.js';
import { toNotificationDto, type NotificationDto } from '../mappers/notification.mapper.js';
import type { NotificationDoc } from '../models/notification.model.js';
import type { TicketDoc } from '../models/ticket.model.js';
import type { NotificationRepository } from '../repositories/notification.repository.js';
import type { ListNotificationsQuery } from '../schemas/notification.schema.js';
import type { AuthUser } from '../types/express.js';

export interface NotificationPage {
  data: NotificationDto[];
  meta: { page: number; limit: number; total: number; unreadCount: number };
}

export class NotificationService {
  constructor(
    private readonly notifications: NotificationRepository,
    private readonly logger: Logger,
  ) {}

  async notifyAuthor(
    ticket: Pick<TicketDoc, '_id' | 'authorUser' | 'number' | 'subject'>,
    event: Pick<NotificationDoc, 'type' | 'status'>,
  ): Promise<void> {
    try {
      await this.notifications.create({
        user: ticket.authorUser,
        ticket: ticket._id,
        ticketNumber: ticket.number,
        subject: ticket.subject,
        ...event,
      });
    } catch (err) {
      this.logger.warn({ err, ticketId: ticket._id.toString() }, 'Failed to write notification');
    }
  }

  async list(user: AuthUser, query: ListNotificationsQuery): Promise<NotificationPage> {
    const { page, limit } = query;
    const { rows, total, unreadCount } = await this.notifications.listForUser(user.id, { page, limit });
    return { data: rows.map(toNotificationDto), meta: { page, limit, total, unreadCount } };
  }

  async markRead(user: AuthUser, ticketId?: string): Promise<{ updated: number }> {
    return { updated: await this.notifications.markRead(user.id, ticketId) };
  }
}
