import type { Request, Response } from 'express';
import { currentUser } from '../middleware/auth.js';
import type { LoginBody } from '../schemas/auth.schema.js';
import type { AuthService } from '../services/auth.service.js';

/** Controllers translate HTTP <-> service calls. Bodies were already validated by middleware. */
export function createAuthController(auth: AuthService) {
  return {
    login: async (req: Request, res: Response) => {
      const { email, password } = req.body as LoginBody;
      res.json({ data: await auth.login(email, password) });
    },

    me: async (req: Request, res: Response) => {
      res.json({ data: await auth.me(currentUser(req).id) });
    },
  };
}
