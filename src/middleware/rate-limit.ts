import { rateLimit, type Options } from 'express-rate-limit';
import { currentUser } from './auth.js';

function userRateLimiter(
  options: { max: number; windowMs: number },
  message: string,
  extra: Partial<Options> = {},
) {
  return rateLimit({
    windowMs: options.windowMs,
    limit: options.max,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (req) => currentUser(req).id,
    handler: (_req, res) => {
      res.status(429).json({ error: { code: 'RATE_LIMITED', message } });
    },
    ...extra,
  });
}

export function replyRateLimiter(options: { max: number; windowMs: number }) {
  return userRateLimiter(
    options,
    'You are sending replies too quickly. Please wait a few minutes and try again.',
  );
}

export function ticketRateLimiter(options: { max: number; windowMs: number }) {
  const minutes = Math.round(options.windowMs / 60_000);
  return userRateLimiter(
    options,
    `You can raise up to ${options.max} queries every ${minutes} minutes. Please try again later.`,
    { skipFailedRequests: true },
  );
}
