import type { Role } from '../domain/enums.js';

export interface AuthUser {
  id: string;
  role: Role;
  /** Business key (AUTH001) for author accounts; undefined for admins. */
  authorId?: string;
}

declare global {
  namespace Express {
    interface Request {
      /** Set by the `authenticate` middleware. */
      user?: AuthUser;
    }
  }
}
