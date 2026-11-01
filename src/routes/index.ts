import { Router } from 'express';
import mongoose from 'mongoose';
import type { Container } from '../container.js';
import { createAdminController } from '../controllers/admin.controller.js';
import { createAuthController } from '../controllers/auth.controller.js';
import { createBookController } from '../controllers/book.controller.js';
import { createNotificationController } from '../controllers/notification.controller.js';
import { createTicketController } from '../controllers/ticket.controller.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { replyRateLimiter, ticketRateLimiter } from '../middleware/rate-limit.js';
import { validate } from '../middleware/validate.js';
import { aiUsageQuery, authorIdParams, listAuthorsQuery } from '../schemas/admin.schema.js';
import { loginBody } from '../schemas/auth.schema.js';
import { bookIdParams, listBooksQuery } from '../schemas/book.schema.js';
import { listNotificationsQuery, markNotificationsReadBody } from '../schemas/notification.schema.js';
import {
  aiDraftBody,
  createNoteBody,
  createReplyBody,
  createResponseBody,
  createTicketBody,
  listTicketsQuery,
  updateTicketBody,
} from '../schemas/ticket.schema.js';

/**
 * The whole v1 route table in one place, so auth, RBAC and validation for
 * every endpoint can be reviewed at a glance.
 */
export function createApiRouter(container: Container): Router {
  const router = Router();
  const auth = createAuthController(container.authService);
  const books = createBookController(container.bookService);
  const tickets = createTicketController(container.ticketService, container.draftService);
  const admin = createAdminController(container.adminService);
  const notifications = createNotificationController(container.notificationService);

  const requireAuth = authenticate(container.tokens);
  const adminOnly = requireRole('admin');
  const authorOnly = requireRole('author');

  // Public
  router.get('/health', (_req, res) => {
    const dbUp = mongoose.connection.readyState === 1;
    res.status(dbUp ? 200 : 503).json({ status: dbUp ? 'ok' : 'degraded' });
  });
  router.post('/auth/login', validate({ body: loginBody }), auth.login);

  // Everything below requires a valid token
  router.use(requireAuth);

  router.get('/auth/me', auth.me);

  router.get('/books', validate({ query: listBooksQuery }), books.list);
  router.get('/books/:bookId', validate({ params: bookIdParams }), books.get);

  router.post(
    '/tickets',
    authorOnly,
    ticketRateLimiter(container.config.ticketRateLimit),
    validate({ body: createTicketBody }),
    tickets.create,
  );
  router.get('/tickets', validate({ query: listTicketsQuery }), tickets.list);
  router.get('/tickets/:ticketId', tickets.get);
  router.patch('/tickets/:ticketId', adminOnly, validate({ body: updateTicketBody }), tickets.update);
  router.post(
    '/tickets/:ticketId/responses',
    adminOnly,
    validate({ body: createResponseBody }),
    tickets.respond,
  );
  router.post(
    '/tickets/:ticketId/replies',
    authorOnly,
    replyRateLimiter(container.config.replyRateLimit),
    validate({ body: createReplyBody }),
    tickets.reply,
  );
  router.post('/tickets/:ticketId/notes', adminOnly, validate({ body: createNoteBody }), tickets.addNote);
  router.post('/tickets/:ticketId/ai-draft', adminOnly, validate({ body: aiDraftBody }), tickets.aiDraft);

  router.get('/notifications', authorOnly, validate({ query: listNotificationsQuery }), notifications.list);
  router.post(
    '/notifications/read',
    authorOnly,
    validate({ body: markNotificationsReadBody }),
    notifications.markRead,
  );

  router.get('/admin/users', adminOnly, admin.users);
  router.get('/admin/authors', adminOnly, validate({ query: listAuthorsQuery }), admin.authors);
  router.get('/admin/authors/:authorId', adminOnly, validate({ params: authorIdParams }), admin.author);
  router.get('/admin/stats', adminOnly, admin.stats);
  router.get('/admin/ai-usage', adminOnly, validate({ query: aiUsageQuery }), admin.aiUsage);

  return router;
}
