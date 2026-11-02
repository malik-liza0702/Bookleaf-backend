import type { Role } from '../domain/enums.js';

export interface AuthUser {
  id: string;
  role: Role;
  authorId?: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}
