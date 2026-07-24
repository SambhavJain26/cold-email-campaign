// The sentiment-suggestion seam (decision E). The suggestion is ADVISORY: it is
// stored on `incoming_messages.suggested_sentiment` and shown greyed-out in the
// Unibox, and it NEVER becomes the effective sentiment - only an operator's
// `sentiment_tagged` event does that (decision M). Auto-enabled iff
// ANTHROPIC_API_KEY is set; unset → composition passes nothing and the whole
// path is inert.
import type { Sentiment } from '@coldemail/shared';

export interface SentimentSuggester {
  /**
   * Suggest a sentiment for a reply body. MUST NOT throw and MUST NOT block the
   * poll cycle: any failure, timeout, or unparseable answer resolves to null
   * (docs/07 §2 bucket 3).
   */
  suggest(text: string): Promise<Sentiment | null>;
}

/** Test double: returns whatever it was constructed with, records its calls. */
export class StaticSuggester implements SentimentSuggester {
  readonly calls: string[] = [];
  constructor(private readonly result: Sentiment | null) {}
  suggest(text: string): Promise<Sentiment | null> {
    this.calls.push(text);
    return Promise.resolve(this.result);
  }
}
