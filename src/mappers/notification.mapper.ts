import { formatTicketNumber, type NotificationType, type TicketStatus } from '../domain/enums.js';
import type { NotificationDoc } from '../models/notification.model.js';

export interface NotificationDto {
  id: string;
  type: NotificationType;
  ticketId: string;
  ticketNumber: string;
  subject: string;
  status: TicketStatus | null;
  message: string;
  read: boolean;
  createdAt: string;
}

function messageFor({ type, status }: Pick<NotificationDoc, 'type' | 'status'>): string {
  if (type === 'status_change') return `Your query was marked ${status}`;
  return status
    ? `BookLeaf Support replied and marked your query ${status}`
    : 'BookLeaf Support replied to your query';
}

export function toNotificationDto(notification: NotificationDoc): NotificationDto {
  return {
    id: notification._id.toString(),
    type: notification.type,
    ticketId: notification.ticket.toString(),
    ticketNumber: formatTicketNumber(notification.ticketNumber),
    subject: notification.subject,
    status: notification.status,
    message: messageFor(notification),
    read: notification.readAt !== null,
    createdAt: notification.createdAt.toISOString(),
  };
}
