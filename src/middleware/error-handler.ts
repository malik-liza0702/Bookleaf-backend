import mongoose from 'mongoose';
import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { AppError, Errors, type ErrorDetail } from '../lib/errors.js';
import type { Logger } from '../lib/logger.js';

/** Unknown routes get the contract's NOT_FOUND shape instead of Express's HTML page. */
export const notFoundHandler: RequestHandler = (req) => {
  throw new AppError('NOT_FOUND', `Route ${req.method} ${req.path} not found`);
};

function fromZod(error: ZodError): AppError {
  const details: ErrorDetail[] = error.issues.map((issue) => ({
    field: issue.path.length ? issue.path.join('.') : '(root)',
    message: issue.message,
  }));
  return Errors.validation('Request validation failed', details);
}

/** Mongoose / MongoDB errors that reflect bad input rather than a server fault. */
function fromMongo(error: unknown): AppError | null {
  if (error instanceof mongoose.Error.ValidationError) {
    const details: ErrorDetail[] = Object.values(error.errors).map((issue) => ({
      field: issue.path,
      message: issue.message,
    }));
    return Errors.validation('Request validation failed', details);
  }
  if (error instanceof mongoose.Error.CastError) {
    // Safety net: ids are checked before querying, so this should not happen.
    return Errors.validation('Request validation failed', [
      { field: error.path, message: 'Has an invalid format' },
    ]);
  }
  if (typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 11000) {
    const keys = Object.keys((error as { keyValue?: object }).keyValue ?? {}).join(', ') || 'field';
    return Errors.conflict(`A record with this ${keys} already exists`);
  }
  return null;
}

/** Body-parser errors carry an HTTP status and a `type`. */
function fromBodyParser(error: unknown): AppError | null {
  if (typeof error !== 'object' || error === null || !('type' in error)) return null;
  switch ((error as { type: unknown }).type) {
    case 'entity.parse.failed':
      return Errors.validation('Malformed JSON in request body');
    case 'entity.too.large':
      return Errors.validation('Request body is too large');
    default:
      return null;
  }
}

/**
 * Last stop for every error. Always responds with
 * `{ error: { code, message, details? } }`. Unexpected errors are logged with
 * their stack and returned as a generic INTERNAL_ERROR; stack traces never
 * reach the client, and production hides the original message too.
 */
export function errorHandler(logger: Logger, isProduction: boolean): ErrorRequestHandler {
  return (err: unknown, req, res, _next) => {
    let appError: AppError | null;
    if (err instanceof AppError) appError = err;
    else if (err instanceof ZodError) appError = fromZod(err);
    else appError = fromMongo(err) ?? fromBodyParser(err);

    if (!appError) {
      logger.error({ err, method: req.method, url: req.originalUrl }, 'Unhandled error');
      const message =
        !isProduction && err instanceof Error ? err.message : 'Something went wrong. Please try again.';
      appError = new AppError('INTERNAL_ERROR', message);
    } else if (appError.status >= 500 && appError.code !== 'AI_UNAVAILABLE') {
      // AI_UNAVAILABLE is an expected, already-logged degraded path, not a server fault.
      logger.error({ err, method: req.method, url: req.originalUrl }, appError.message);
    }

    res.status(appError.status).json({
      error: {
        code: appError.code,
        message: appError.message,
        ...(appError.details?.length ? { details: appError.details } : {}),
      },
    });
  };
}
