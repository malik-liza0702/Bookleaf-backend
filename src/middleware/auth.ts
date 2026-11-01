import type { RequestHandler } from 'express';
import type { Role } from '../domain/enums.js';
import { Errors } from '../lib/errors.js';
import type { TokenService } from '../lib/jwt.js';
import type { AuthUser } from '../types/express.js';

/** Verifies the Bearer token and attaches `req.user`. Responds 401 otherwise. */
export function authenticate(tokens: TokenService): RequestHandler {
  return (req, _res, next) => {
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : undefined;
    if (!token) {
      throw Errors.unauthenticated('Missing bearer token');
    }
    const user = tokens.verify(token);
    if (!user) {
      throw Errors.unauthenticated('Invalid or expired token');
    }
    req.user = user;
    next();
  };
}

/** RBAC: only lets through users whose role is in `roles`. Must run after `authenticate`. */
export function requireRole(...roles: Role[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) {
      throw Errors.unauthenticated();
    }
    if (!roles.includes(req.user.role)) {
      throw Errors.forbidden();
    }
    next();
  };
}

/** Narrowing helper for controllers that sit behind `authenticate`. */
export function currentUser(req: { user?: AuthUser }): AuthUser {
  if (!req.user) {
    throw Errors.unauthenticated();
  }
  return req.user;
}
