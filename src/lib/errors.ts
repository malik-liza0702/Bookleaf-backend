/**
 * Every error the API returns uses one of these codes, each with a fixed HTTP
 * status (see API_CONTRACT.md). Services throw AppError; the error handler
 * turns it into `{ error: { code, message, details? } }`.
 */
export const ERROR_STATUS = {
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  AI_UNAVAILABLE: 503,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

export interface ErrorDetail {
  field: string;
  message: string;
}

export class AppError extends Error {
  readonly status: number;

  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: ErrorDetail[],
  ) {
    super(message);
    this.name = 'AppError';
    this.status = ERROR_STATUS[code];
  }
}

export const Errors = {
  validation: (message: string, details?: ErrorDetail[]) =>
    new AppError('VALIDATION_ERROR', message, details),
  unauthenticated: (message = 'Authentication required') => new AppError('UNAUTHENTICATED', message),
  forbidden: (message = 'You do not have permission to perform this action') =>
    new AppError('FORBIDDEN', message),
  notFound: (resource: string) => new AppError('NOT_FOUND', `${resource} not found`),
  conflict: (message: string) => new AppError('CONFLICT', message),
  aiUnavailable: () =>
    new AppError('AI_UNAVAILABLE', 'AI draft unavailable. You can write a response manually.'),
};
