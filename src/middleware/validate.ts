import type { RequestHandler } from 'express';
import type { z } from 'zod';

interface RequestSchemas {
  body?: z.ZodType;
  query?: z.ZodType;
  params?: z.ZodType;
}

/**
 * Parses body/query/params with Zod and replaces them with the parsed (typed,
 * coerced, defaulted) values. A ZodError propagates to the error handler,
 * which turns it into a 400 VALIDATION_ERROR with per-field details.
 *
 * Express 5 exposes `req.query` as a getter, so the parsed query is defined
 * as an own property on the request instead of being assigned.
 */
export function validate(schemas: RequestSchemas): RequestHandler {
  return (req, _res, next) => {
    if (schemas.params) {
      req.params = schemas.params.parse(req.params) as typeof req.params;
    }
    if (schemas.query) {
      const query = schemas.query.parse(req.query);
      Object.defineProperty(req, 'query', { value: query, writable: true, enumerable: true });
    }
    if (schemas.body) {
      req.body = schemas.body.parse(req.body ?? {});
    }
    next();
  };
}
