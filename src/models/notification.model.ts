import { Schema, model, type Types } from 'mongoose';
import {
  NOTIFICATION_TYPES,
  TICKET_STATUSES,
  type NotificationType,
  type TicketStatus,
} from '../domain/enums.js';

/**
 * One document per thing an author should hear about. The ticket number and
 * subject are copied in (like the admin name on a reply) so rendering the list
 * needs no lookups. Only author-visible data belongs here.
 */
export interface NotificationDoc {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  ticket: Types.ObjectId;
  type: NotificationType;
  ticketNumber: number;
  subject: string;
  /** The new status if this event changed it, otherwise null. */
  status: TicketStatus | null;
  readAt: Date | null;
  createdAt: Date;
}

const notificationSchema = new Schema<NotificationDoc>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    ticket: { type: Schema.Types.ObjectId, ref: 'Ticket', required: true },
    type: { type: String, enum: NOTIFICATION_TYPES, required: true },
    ticketNumber: { type: Number, required: true },
    subject: { type: String, required: true },
    status: { type: String, enum: [...TICKET_STATUSES, null], default: null },
    readAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

notificationSchema.index({ user: 1, createdAt: -1 }); // the author's list, newest first
notificationSchema.index({ user: 1, readAt: 1 }); // unread count and mark-as-read

export const NotificationModel = model<NotificationDoc>('Notification', notificationSchema);
