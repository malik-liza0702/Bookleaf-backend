import { z } from 'zod';
import type { AiConfig } from '../ai/index.js';
import { DEFAULT_DB_NAME } from '../lib/db.js';

/**
 * All configuration comes from environment variables, validated once at boot.
 * The process refuses to start with a clear message if something required is
 * missing, instead of failing later on the first request that needs it.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  MONGODB_URI: z
    .string()
    .min(1, 'MONGODB_URI is required')
    .refine((v) => /^mongodb(\+srv)?:\/\//.test(v), 'MONGODB_URI must start with mongodb:// or mongodb+srv://'),
  MONGODB_DB_NAME: z.string().trim().min(1).default(DEFAULT_DB_NAME),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('8h'),

  CORS_ORIGIN: z
    .string()
    .default('http://localhost:5173')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),

  TICKET_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(5),
  TICKET_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60 * 60 * 1000),
  REPLY_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),
  REPLY_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),

  // Empty string is treated as "not set" so `GEMINI_API_KEY=` in .env means degraded mode.
  GEMINI_API_KEY: z
    .string()
    .optional()
    .transform((value) => (value && value.trim() ? value.trim() : undefined)),
  AI_CLASSIFY_MODEL: z.string().min(1).default('gemini-3.5-flash-lite'),
  AI_DRAFT_MODEL: z.string().min(1).default('gemini-3.8-flash'),
  AI_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  AI_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
});

export type Env = z.infer<typeof envSchema>;

export interface AppConfig {
  env: Env['NODE_ENV'];
  isProduction: boolean;
  port: number;
  logLevel: Env['LOG_LEVEL'];
  mongoUri: string;
  mongoDbName: string;
  jwt: { secret: string; expiresIn: string };
  corsOrigins: string[];
  ticketRateLimit: { max: number; windowMs: number };
  replyRateLimit: { max: number; windowMs: number };
  ai: AiConfig;
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  const env = parsed.data;
  return {
    env: env.NODE_ENV,
    isProduction: env.NODE_ENV === 'production',
    port: env.PORT,
    logLevel: env.LOG_LEVEL,
    mongoUri: env.MONGODB_URI,
    mongoDbName: env.MONGODB_DB_NAME,
    jwt: { secret: env.JWT_SECRET, expiresIn: env.JWT_EXPIRES_IN },
    corsOrigins: env.CORS_ORIGIN,
    ticketRateLimit: { max: env.TICKET_RATE_LIMIT_MAX, windowMs: env.TICKET_RATE_LIMIT_WINDOW_MS },
    replyRateLimit: { max: env.REPLY_RATE_LIMIT_MAX, windowMs: env.REPLY_RATE_LIMIT_WINDOW_MS },
    ai: {
      apiKey: env.GEMINI_API_KEY,
      classifyModel: env.AI_CLASSIFY_MODEL,
      draftModel: env.AI_DRAFT_MODEL,
      timeoutMs: env.AI_TIMEOUT_MS,
      maxRetries: env.AI_MAX_RETRIES,
    },
  };
}
