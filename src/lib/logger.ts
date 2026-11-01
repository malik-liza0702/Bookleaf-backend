import { pino, type Logger } from 'pino';

export type { Logger };

/**
 * Structured JSON logs in production; pretty, human-readable logs in development.
 * Authorization headers, cookies and passwords are redacted everywhere.
 */
export function createLogger(options: { level: string; pretty: boolean }): Logger {
  return pino({
    level: options.level,
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.passwordHash'],
      censor: '[redacted]',
    },
    ...(options.pretty
      ? { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss' } } }
      : {}),
  });
}
