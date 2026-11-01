import { classifyByRules, type AiService, type ClassificationResult, type ClassifyInput } from '../ai/index.js';
import type { Logger } from '../lib/logger.js';
import { toBookContext } from '../mappers/ai-context.mapper.js';
import type { TicketRepository } from '../repositories/ticket.repository.js';
import type { AiCallRecorder } from './ai-call-recorder.js';

/**
 * Classifies one ticket and stores the result. Runs in the background (see
 * jobs/classification-queue.ts), never inside the request that created the
 * ticket.
 *
 * The AI module already falls back to its rule-based classifier when the model
 * fails; this service adds one more safety net in case the module itself
 * throws, so a ticket can never stay "pending" because of an AI problem.
 */
export class ClassificationService {
  constructor(
    private readonly ai: AiService,
    private readonly tickets: TicketRepository,
    private readonly recorder: AiCallRecorder,
    private readonly classifyModel: string,
    private readonly logger: Logger,
  ) {}

  async classify(ticketId: string): Promise<void> {
    const ticket = await this.tickets.findForClassification(ticketId);
    if (!ticket || ticket.aiStatus !== 'pending') return;

    const input: ClassifyInput = {
      subject: ticket.subject,
      description: ticket.description,
      book: toBookContext(ticket.book),
    };

    const startedAt = Date.now();
    const result = await this.runClassifier(input, ticketId);
    const usedRules = result.source === 'rules';

    await this.tickets.saveClassification(ticketId, {
      aiStatus: usedRules ? 'failed' : 'done',
      category: result.category,
      priority: result.priority,
      reasoning: usedRules ? this.rulesReasoning(result) : result.reasoning,
      confidence: usedRules ? null : result.confidence,
    });

    await this.recorder.record({
      kind: 'classify',
      ticketId,
      model: this.classifyModel,
      usage: result.usage,
      error: result.error ?? (usedRules ? { code: 'UNKNOWN' } : undefined),
      elapsedMs: Date.now() - startedAt,
    });

    this.logger.info(
      { ticketId, source: result.source, category: result.category, priority: result.priority },
      'Ticket classified',
    );
  }

  private async runClassifier(input: ClassifyInput, ticketId: string): Promise<ClassificationResult> {
    try {
      return await this.ai.classifyTicket(input);
    } catch (err) {
      this.logger.error({ err, ticketId }, 'AI module threw during classification; using rules');
      return {
        ...classifyByRules(input),
        error: { code: 'UNKNOWN', message: err instanceof Error ? err.message : 'Unknown error' },
      };
    }
  }

  /** Makes it obvious to admins that rules, not the model, produced this. */
  private rulesReasoning(result: ClassificationResult): string {
    if (/rule/i.test(result.reasoning)) return result.reasoning;
    const why = result.error?.code === 'NO_API_KEY' ? 'AI not configured' : 'AI unavailable';
    return `Rule-based classification (${why}): ${result.reasoning}`;
  }
}
