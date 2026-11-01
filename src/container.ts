import { createAiService, type AiService } from './ai/index.js';
import type { AppConfig } from './config/env.js';
import { ClassificationQueue } from './jobs/classification-queue.js';
import { TokenService } from './lib/jwt.js';
import type { Logger } from './lib/logger.js';
import { AiCallLogRepository } from './repositories/ai-call-log.repository.js';
import { BookRepository } from './repositories/book.repository.js';
import { NotificationRepository } from './repositories/notification.repository.js';
import { TicketRepository } from './repositories/ticket.repository.js';
import { UserRepository } from './repositories/user.repository.js';
import { AdminService } from './services/admin.service.js';
import { AiCallRecorder } from './services/ai-call-recorder.js';
import { AuthService } from './services/auth.service.js';
import { BookService } from './services/book.service.js';
import { ClassificationService } from './services/classification.service.js';
import { DraftService } from './services/draft.service.js';
import { NotificationService } from './services/notification.service.js';
import { TicketService } from './services/ticket.service.js';

/**
 * Composition root: the one place where concrete classes are wired together.
 * Everything else receives its dependencies through constructors, which is
 * what lets tests swap the AI service for a fake.
 */
export function createContainer(config: AppConfig, logger: Logger, overrides: { ai?: AiService } = {}) {
  const ai = overrides.ai ?? createAiService(config.ai);

  const users = new UserRepository();
  const books = new BookRepository();
  const tickets = new TicketRepository();
  const aiLogs = new AiCallLogRepository();
  const notifications = new NotificationRepository();

  const tokens = new TokenService(config.jwt.secret, config.jwt.expiresIn);
  const recorder = new AiCallRecorder(aiLogs, logger);
  const notificationService = new NotificationService(notifications, logger);

  const classificationService = new ClassificationService(
    ai,
    tickets,
    recorder,
    config.ai.classifyModel,
    logger,
  );
  const classificationQueue = new ClassificationQueue(
    (ticketId) => classificationService.classify(ticketId),
    logger,
  );

  return {
    config,
    logger,
    ai,
    tokens,
    ticketRepository: tickets,
    classificationQueue,
    authService: new AuthService(users, tokens),
    bookService: new BookService(books),
    ticketService: new TicketService(tickets, books, users, classificationQueue, notificationService),
    notificationService,
    draftService: new DraftService(ai, tickets, users, recorder, config.ai.draftModel, logger),
    adminService: new AdminService(users, books, tickets, aiLogs, ai.enabled),
  };
}

export type Container = ReturnType<typeof createContainer>;
