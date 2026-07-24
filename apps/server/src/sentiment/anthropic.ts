// Decision E's concrete adapter: one Messages API call per human reply, asking
// for a sentiment label. Wired ONLY by composition.ts (like the transports), and
// only when ANTHROPIC_API_KEY is set.
//
// Three properties are load-bearing (docs/07 §2 bucket 3):
//   1. It never throws - every failure path resolves to null.
//   2. It never blocks the poll cycle for long - 3s budget, no retries.
//   3. It never decides anything - the answer is a suggestion the operator
//      confirms; the reply's effective sentiment still comes from the log.
import Anthropic from '@anthropic-ai/sdk';
import { SENTIMENTS, type Sentiment } from '@coldemail/shared';
import type { SentimentSuggester } from './types';

/** docs/07 §2: "Failure/timeout (3s) → null, never blocks." */
const TIMEOUT_MS = 3_000;
/** A reply body is long; the classifier only needs the opening. */
const MAX_INPUT_CHARS = 2_000;

const SYSTEM_PROMPT = [
  'You classify replies to cold sales emails for a single-operator outreach tool.',
  'Answer with the sentiment of the REPLY ONLY, ignoring any quoted original message.',
  'positive = interest, a meeting request, or a referral to the right person.',
  'neutral = an acknowledgement, a question, "not right now", or an ambiguous answer.',
  'negative = a rejection, an opt-out request, or annoyance.',
  'Do not include internal or system XML tags in your response.',
].join(' ');

/** Structured outputs make the answer parseable by construction. */
const RESPONSE_SCHEMA = {
  type: 'object',
  properties: { sentiment: { type: 'string', enum: [...SENTIMENTS] } },
  required: ['sentiment'],
  additionalProperties: false,
} as const;

export interface AnthropicSuggesterOptions {
  apiKey: string;
  /** Override for tests; defaults to the current Claude model. */
  model?: string;
  timeoutMs?: number;
  /** Injected in tests - the SDK instance to call. */
  client?: Pick<Anthropic, 'messages'>;
}

export class AnthropicSentimentSuggester implements SentimentSuggester {
  private readonly client: Pick<Anthropic, 'messages'>;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(opts: AnthropicSuggesterOptions) {
    this.client = opts.client ?? new Anthropic({ apiKey: opts.apiKey, maxRetries: 0 });
    this.model = opts.model ?? 'claude-opus-5';
    this.timeoutMs = opts.timeoutMs ?? TIMEOUT_MS;
  }

  async suggest(text: string): Promise<Sentiment | null> {
    const body = text.trim().slice(0, MAX_INPUT_CHARS);
    if (body === '') return null;

    try {
      const response = await this.client.messages.create(
        {
          model: this.model,
          max_tokens: 64,
          system: SYSTEM_PROMPT,
          // Thinking is ON by default on Claude Opus 5 and shares the
          // max_tokens budget - for a 3s label call that is pure latency.
          thinking: { type: 'disabled' },
          output_config: { format: { type: 'json_schema', schema: RESPONSE_SCHEMA } },
          messages: [{ role: 'user', content: body }],
        },
        // TS SDK timeouts are MILLISECONDS; no retries inside the budget.
        { timeout: this.timeoutMs, maxRetries: 0 },
      );

      // A safety refusal returns 200 with an empty/partial content array -
      // never index content[0] before checking (docs: stop_reason first).
      if (response.stop_reason === 'refusal') return null;
      return parseSentiment(response.content);
    } catch {
      // Network error, timeout, 4xx/5xx: the suggestion is optional, the poll
      // cycle is not. Swallow and move on.
      return null;
    }
  }
}

function parseSentiment(content: Anthropic.ContentBlock[]): Sentiment | null {
  const text = content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('');
  if (text.trim() === '') return null;

  try {
    const parsed: unknown = JSON.parse(text);
    const value = (parsed as { sentiment?: unknown } | null)?.sentiment;
    return isSentiment(value) ? value : null;
  } catch {
    return null; // model answered with something that isn't our schema
  }
}

function isSentiment(value: unknown): value is Sentiment {
  return typeof value === 'string' && (SENTIMENTS as readonly string[]).includes(value);
}
