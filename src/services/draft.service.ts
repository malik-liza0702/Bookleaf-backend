import {
  AiUnavailableError,
  buildFallbackDraft,
  classifyByRules,
  type AiService,
  type DraftInput,
  type DraftRevision,
  type TicketCategory,
} from '../ai/index.js';
import { formatTicketNumber } from '../domain/enums.js';
import { Errors } from '../lib/errors.js';
import type { Logger } from '../lib/logger.js';
import { toBookContext } from '../mappers/ai-context.mapper.js';
import { toAiDraftDto, type AiDraftDto } from '../mappers/ticket.mapper.js';
import type { DraftContextRecord, TicketRepository } from '../repositories/ticket.repository.js';
import type { UserRepository } from '../repositories/user.repository.js';
import type { AiCallRecorder } from './ai-call-recorder.js';

export class DraftService {
  constructor(
    private readonly ai: AiService,
    private readonly tickets: TicketRepository,
    private readonly users: UserRepository,
    private readonly recorder: AiCallRecorder,
    private readonly draftModel: string,
    private readonly logger: Logger,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async getDraft(ticketId: string, options: { regenerate: boolean; revision?: DraftRevision | undefined }): Promise<AiDraftDto> {
    const ticket = await this.tickets.findForDraft(ticketId);
    if (!ticket) throw Errors.notFound('Ticket');

    if (ticket.aiDraft && !options.regenerate && !options.revision) {
      return toAiDraftDto(ticket.aiDraft);
    }

    const input: DraftInput = { ...(await this.buildInput(ticket)), revision: options.revision };
    const startedAt = Date.now();
    try {
      const result = await this.ai.generateDraft(input);
      await this.recorder.record({
        kind: 'draft',
        ticketId,
        model: this.draftModel,
        usage: result.usage,
        elapsedMs: Date.now() - startedAt,
      });
      const draft = {
        text: result.text,
        model: result.model,
        fallback: false,
        warnings: result.warnings,
        generatedAt: this.now(),
      };
      await this.tickets.saveDraft(ticketId, draft);
      return toAiDraftDto(draft);
    } catch (err) {
      const code = err instanceof AiUnavailableError ? err.code : 'UNKNOWN';
      await this.recorder.record({
        kind: 'draft',
        ticketId,
        model: this.draftModel,
        usage: err instanceof AiUnavailableError ? err.usage : undefined,
        error: { code },
        elapsedMs: Date.now() - startedAt,
      });
      if (options.revision) {
        this.logger.warn({ err, ticketId, code }, 'AI draft revision failed');
        throw Errors.aiUnavailable();
      }
      this.logger.warn({ err, ticketId, code }, 'AI draft failed; serving template draft');
      return this.templateDraft(input, ticketId);
    }
  }

  private templateDraft(input: DraftInput, ticketId: string): AiDraftDto {
    try {
      const { text, warnings } = buildFallbackDraft(input);
      return toAiDraftDto({ text, model: 'template', fallback: true, warnings, generatedAt: this.now() });
    } catch (err) {
      this.logger.error({ err, ticketId }, 'Template draft failed too');
      throw Errors.aiUnavailable();
    }
  }

  private async buildInput(ticket: DraftContextRecord): Promise<DraftInput> {
    const book = toBookContext(ticket.book);
    const author = await this.users.findAuthorByAuthorId(ticket.authorId);
    return {
      ticket: {
        ticketNumber: formatTicketNumber(ticket.number),
        subject: ticket.subject,
        description: ticket.description,
        status: ticket.status,
        category: this.categoryForDraft(ticket, book),
        priority: ticket.priority,
        createdAt: ticket.createdAt.toISOString(),
      },
      author: { name: ticket.authorUser?.name ?? 'there', city: author?.city ?? null },
      book,
      thread: ticket.responses.map((response) => ({
        from: response.from ?? 'support',
        message: response.message,
        createdAt: response.createdAt.toISOString(),
      })),
      now: this.now(),
    };
  }

  private categoryForDraft(ticket: DraftContextRecord, book: DraftInput['book']): TicketCategory {
    if (ticket.aiStatus === 'pending' && !ticket.categoryOverridden) {
      return classifyByRules({ subject: ticket.subject, description: ticket.description, book }).category;
    }
    return ticket.category;
  }
}
