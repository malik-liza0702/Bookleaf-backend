import type { Request, Response } from 'express';
import { currentUser } from '../middleware/auth.js';
import type {
  AiDraftBody,
  CreateNoteBody,
  CreateReplyBody,
  CreateResponseBody,
  CreateTicketBody,
  ListTicketsQuery,
  UpdateTicketBody,
} from '../schemas/ticket.schema.js';
import type { DraftService } from '../services/draft.service.js';
import type { TicketService } from '../services/ticket.service.js';

type TicketRequest = Request<{ ticketId: string }>;

export function createTicketController(tickets: TicketService, drafts: DraftService) {
  return {
    create: async (req: Request, res: Response) => {
      const ticket = await tickets.create(currentUser(req), req.body as CreateTicketBody);
      res.status(201).json({ data: ticket });
    },

    list: async (req: Request, res: Response) => {
      res.json(await tickets.list(currentUser(req), req.query as unknown as ListTicketsQuery));
    },

    get: async (req: TicketRequest, res: Response) => {
      res.json({ data: await tickets.get(currentUser(req), req.params.ticketId) });
    },

    update: async (req: TicketRequest, res: Response) => {
      const ticket = await tickets.update(currentUser(req), req.params.ticketId, req.body as UpdateTicketBody);
      res.json({ data: ticket });
    },

    reply: async (req: TicketRequest, res: Response) => {
      const ticket = await tickets.reply(currentUser(req), req.params.ticketId, req.body as CreateReplyBody);
      res.status(201).json({ data: ticket });
    },

    respond: async (req: TicketRequest, res: Response) => {
      const ticket = await tickets.respond(
        currentUser(req),
        req.params.ticketId,
        req.body as CreateResponseBody,
      );
      res.status(201).json({ data: ticket });
    },

    addNote: async (req: TicketRequest, res: Response) => {
      const ticket = await tickets.addNote(currentUser(req), req.params.ticketId, req.body as CreateNoteBody);
      res.status(201).json({ data: ticket });
    },

    aiDraft: async (req: TicketRequest, res: Response) => {
      const { regenerate, revision } = req.body as AiDraftBody;
      res.json({ data: await drafts.getDraft(req.params.ticketId, { regenerate, revision }) });
    },
  };
}
