import type { Request, Response } from 'express';
import type { AiUsageQuery, AuthorIdParams, ListAuthorsQuery } from '../schemas/admin.schema.js';
import type { AdminService } from '../services/admin.service.js';

export function createAdminController(admin: AdminService) {
  return {
    users: async (_req: Request, res: Response) => {
      res.json({ data: await admin.listAdmins() });
    },

    authors: async (req: Request, res: Response) => {
      res.json(await admin.listAuthors(req.query as unknown as ListAuthorsQuery));
    },

    author: async (req: Request, res: Response) => {
      const { authorId } = req.params as AuthorIdParams;
      res.json({ data: await admin.getAuthor(authorId) });
    },

    stats: async (_req: Request, res: Response) => {
      res.json({ data: await admin.stats() });
    },

    aiUsage: async (req: Request, res: Response) => {
      const { days } = req.query as unknown as AiUsageQuery;
      res.json({ data: await admin.aiUsage(days) });
    },
  };
}
