import { authorTextOf, checkDraft, normalizeDraft } from './draftChecks.js';
import { ticketFacts } from './facts.js';
import { ModelCallError, type ModelCaller } from './modelCaller.js';
import { buildDraftPrompt, DRAFT_SYSTEM_PROMPT } from './prompts/draft.js';
import { AiUnavailableError, type DraftInput, type DraftResult } from './types.js';

export const DRAFT_MAX_OUTPUT_TOKENS = 3072;
export const REVISION_MAX_OUTPUT_TOKENS = 3072;
const MIN_DRAFT_CHARS = 80;

export const DRAFT_UNAVAILABLE_MESSAGE = 'AI draft unavailable. You can write a response manually.';

export async function generateDraft(caller: ModelCaller, model: string, input: DraftInput): Promise<DraftResult> {
  const facts = ticketFacts(input.book, input.now);
  try {
    const result = await caller.run({
      model,
      system: DRAFT_SYSTEM_PROMPT,
      prompt: buildDraftPrompt(input, facts),
      maxOutputTokens: input.revision ? REVISION_MAX_OUTPUT_TOKENS : DRAFT_MAX_OUTPUT_TOKENS,
      thinking: 'low',
    });
    if (result.text.length < MIN_DRAFT_CHARS) {
      throw new ModelCallError('INVALID_OUTPUT', `Draft too short (${result.text.length} chars)`, result.usage);
    }

    const text = normalizeDraft(result.text);
    return { text, model, usage: result.usage, warnings: checkDraft(text, facts, authorTextOf(input)) };
  } catch (err) {
    const error = err instanceof ModelCallError ? err : new ModelCallError('UNKNOWN', String(err));
    const unavailable = new AiUnavailableError(error.code, DRAFT_UNAVAILABLE_MESSAGE, error.usage);
    unavailable.cause = error;
    throw unavailable;
  }
}
