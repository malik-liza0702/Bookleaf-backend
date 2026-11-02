import type { RequestHandler } from 'express';
import type { Role } from '../domain/enums.js';
import { Errors } from '../lib/errors.js';
import type { TokenService } from '../lib/jwt.js';
import type { AuthUser } from '../types/express.js';

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

export function currentUser(req: { user?: AuthUser }): AuthUser {
  if (!req.user) {
    throw Errors.unauthenticated();
  }
  return req.user;
}
