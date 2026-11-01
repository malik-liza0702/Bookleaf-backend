/**
 * Public API of the AI module (see AI_MODULE_CONTRACT.md). The core backend
 * imports only from here. The module is pure: no database, HTTP framework or
 * process.env access; configuration comes in through createAiService().
 */

export {
  AiUnavailableError,
  TICKET_CATEGORIES,
  TICKET_PRIORITIES,
  type AiCallError,
  type AiConfig,
  type AiErrorCode,
  type AiService,
  type AiUsage,
  type BookContext,
  type ClassificationResult,
  type ClassifyInput,
  type DraftInput,
  type DraftRevision,
  type DraftResult,
  type ThreadMessage,
  type TicketCategory,
  type TicketPriority,
} from './types.js';
export { createAiService, type AiServiceDeps } from './service.js';
export { classifyByRules } from './rulesClassifier.js';
export { nextRoyaltyPayout } from './facts.js';
export { buildFallbackDraft, type FallbackDraft } from './fallbackDraft.js';
export { estimateCostUsd, priceFor, PRICES_AS_OF, type ModelPrice } from './pricing.js';
export { ProviderError, type AiProvider, type GenerateJsonRequest, type GenerateRequest, type ProviderResult } from './provider.js';
