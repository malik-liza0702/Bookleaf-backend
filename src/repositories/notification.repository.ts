import type { QueryFilter } from 'mongoose';
import { NotificationModel, type NotificationDoc } from '../models/notification.model.js';

const NEWEST_FIRST = { createdAt: -1, _id: -1 } as const;

export class NotificationRepository {
  async create(data: Pick<NotificationDoc, 'user' | 'ticket' | 'type' | 'ticketNumber' | 'subject' | 'status'>) {
    await NotificationModel.create(data);
  }

  async listForUser(userId: string, params: { page: number; limit: number }) {
    const [rows, total, unreadCount] = await Promise.all([
      NotificationModel.find({ user: userId })
        .sort(NEWEST_FIRST)
        .skip((params.page - 1) * params.limit)
        .limit(params.limit)
        .lean<NotificationDoc[]>(),
      NotificationModel.countDocuments({ user: userId }),
      NotificationModel.countDocuments({ user: userId, readAt: null }),
    ]);
    return { rows, total, unreadCount };
  }

  async markRead(userId: string, ticketId?: string): Promise<number> {
    const query: QueryFilter<NotificationDoc> = { user: userId, readAt: null };
    if (ticketId) query.ticket = ticketId;
    const result = await NotificationModel.updateMany(query, { $set: { readAt: new Date() } });
    return result.modifiedCount;
  }
}
