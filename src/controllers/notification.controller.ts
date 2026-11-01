import type { Request, Response } from 'express';
import { currentUser } from '../middleware/auth.js';
import type { ListNotificationsQuery, MarkNotificationsReadBody } from '../schemas/notification.schema.js';
import type { NotificationService } from '../services/notification.service.js';

export function createNotificationController(notifications: NotificationService) {
  return {
    list: async (req: Request, res: Response) => {
      res.json(await notifications.list(currentUser(req), req.query as unknown as ListNotificationsQuery));
    },

    markRead: async (req: Request, res: Response) => {
      const { ticketId } = req.body as MarkNotificationsReadBody;
      res.json({ data: await notifications.markRead(currentUser(req), ticketId) });
    },
  };
}
