import { z } from 'zod';
import { ticketFacts } from './facts.js';
import { addUsage, ModelCallError, type ModelCaller } from './modelCaller.js';
import { applyPriorityFloors } from './priorityRules.js';
import {
  buildClassificationPrompt,
  CLASSIFICATION_SCHEMA,
  CLASSIFICATION_SYSTEM_PROMPT,
} from './prompts/classification.js';
import { classifyByRules } from './rulesClassifier.js';
import {
  TICKET_CATEGORIES,
  TICKET_PRIORITIES,
  type AiCallError,
  type AiUsage,
  type ClassificationResult,
  type ClassifyInput,
} from './types.js';

/** The model's answer is validated, never trusted: enums must match exactly. */
export const ModelClassificationSchema = z.object({
  reasoning: z.string().trim().min(1).max(600),
  category: z.enum(TICKET_CATEGORIES),
  priority: z.enum(TICKET_PRIORITIES),
  confidence: z.number().min(0).max(1),
});
export type ModelClassification = z.infer<typeof ModelClassificationSchema>;

/** Output budget includes thinking tokens; the JSON itself is ~60 tokens. */
export const CLASSIFY_MAX_OUTPUT_TOKENS = 512;
const LOW_CONFIDENCE = 0.6;
/** One retry when the model answers but the JSON is unusable. Transport retries happen below this. */
const MAX_PARSE_ATTEMPTS = 2;

export function parseModelClassification(text: string): ModelClassification | null {
  const json = text.replace(/^```(?:json)?\s*|\s*```$/g, '');
  try {
    const parsed = ModelClassificationSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function classifyTicket(
  caller: ModelCaller,
  model: string,
  input: ClassifyInput,
): Promise<ClassificationResult> {
  const now = input.now ?? new Date();
  const facts = ticketFacts(input.book, now);
  const prompt = buildClassificationPrompt(input.subject, input.description, facts);

  let usage: AiUsage | undefined;
  let lastError: AiCallError = { code: 'UNKNOWN', message: 'Classification did not run' };

  for (let attempt = 1; attempt <= MAX_PARSE_ATTEMPTS; attempt++) {
    try {
      const result = await caller.run({
        model,
        system: CLASSIFICATION_SYSTEM_PROMPT,
        prompt,
        schema: CLASSIFICATION_SCHEMA,
        maxOutputTokens: CLASSIFY_MAX_OUTPUT_TOKENS,
        thinking: 'minimal',
      });
      usage = addUsage(usage, result.usage);

      const parsed = parseModelClassification(result.text);
      if (!parsed) {
        lastError = { code: 'INVALID_OUTPUT', message: 'Model output did not match the classification schema' };
        continue;
      }

      const floors = applyPriorityFloors(parsed.category, parsed.priority, `${input.subject}\n${input.description}`, facts);
      const notes = [...floors.notes];
      if (parsed.confidence < LOW_CONFIDENCE) notes.push('Low confidence: please check the category.');
      return {
        category: parsed.category,
        priority: floors.priority,
        reasoning: [parsed.reasoning, ...notes].join(' '),
        confidence: parsed.confidence,
        source: 'ai',
        usage,
      };
    } catch (err) {
      const error = err instanceof ModelCallError ? err : new ModelCallError('UNKNOWN', String(err));
      usage = addUsage(usage, error.usage);
      lastError = { code: error.code, message: error.message };
      // Transport failures were already retried with backoff; only a bad answer earns another try here.
      if (error.code !== 'INVALID_OUTPUT') break;
    }
  }

  return { ...classifyByRules({ ...input, now }), ...(usage ? { usage } : {}), error: lastError };
}
