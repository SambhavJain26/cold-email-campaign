// Decision E: the Anthropic sentiment-suggestion adapter. Pure unit - the SDK
// client is injected, so no network and no API key. What must hold:
//   - a well-formed answer maps to our Sentiment union;
//   - EVERY failure path (timeout, HTTP error, refusal, garbage) yields null;
//   - the call is bounded (3s, no retries) so a poll cycle can't hang on it.
import { describe, expect, it, vi } from 'vitest';
import { AnthropicSentimentSuggester } from '../../src/sentiment/anthropic';

type CreateArgs = [Record<string, unknown>, Record<string, unknown>?];

/** A stand-in for `client.messages` that records how it was called. */
function fakeClient(impl: () => unknown) {
  const create = vi.fn(() => Promise.resolve(impl()));
  return {
    client: { messages: { create } } as never,
    calls: () => create.mock.calls as unknown as CreateArgs[],
  };
}

const jsonAnswer = (sentiment: string) => ({
  stop_reason: 'end_turn',
  content: [{ type: 'text', text: JSON.stringify({ sentiment }) }],
});

function suggesterFor(impl: () => unknown) {
  const fake = fakeClient(impl);
  return {
    suggester: new AnthropicSentimentSuggester({ apiKey: 'test-key', client: fake.client }),
    calls: fake.calls,
  };
}

describe('AnthropicSentimentSuggester (decision E)', () => {
  it('maps a well-formed answer to the Sentiment union', async () => {
    for (const sentiment of ['positive', 'neutral', 'negative'] as const) {
      const { suggester } = suggesterFor(() => jsonAnswer(sentiment));
      expect(await suggester.suggest('Sounds interesting - send times?')).toBe(sentiment);
    }
  });

  it('asks for a bounded, structured, thinking-free answer', async () => {
    const { suggester, calls } = suggesterFor(() => jsonAnswer('positive'));
    await suggester.suggest('Interested!');

    const [body, options] = calls()[0]!;
    expect(body.model).toBe('claude-opus-5');
    expect(body.max_tokens).toBe(64);
    // Thinking is ON by default on Claude Opus 5 and shares the max_tokens
    // budget - for a 3s label call that would be pure latency.
    expect(body.thinking).toEqual({ type: 'disabled' });
    // Structured output means the answer is parseable by construction.
    expect(body.output_config).toMatchObject({ format: { type: 'json_schema' } });
    // Bounded: the TS SDK takes MILLISECONDS, and a retry would blow the budget.
    expect(options).toEqual({ timeout: 3000, maxRetries: 0 });
  });

  it('never spends a call on an empty body', async () => {
    const { suggester, calls } = suggesterFor(() => jsonAnswer('positive'));
    expect(await suggester.suggest('   ')).toBeNull();
    expect(calls()).toHaveLength(0);
  });

  it('truncates a long reply instead of shipping the whole thread', async () => {
    const { suggester, calls } = suggesterFor(() => jsonAnswer('neutral'));
    await suggester.suggest('x'.repeat(10_000));
    const content = (calls()[0]![0].messages as { content: string }[])[0]!.content;
    expect(content.length).toBe(2_000);
  });

  it('returns null on a safety refusal without touching content', async () => {
    const { suggester } = suggesterFor(() => ({ stop_reason: 'refusal', content: [] }));
    expect(await suggester.suggest('...')).toBeNull();
  });

  it('returns null on garbage, an unknown label, or a missing text block', async () => {
    const cases: unknown[] = [
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'not json at all' }] },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: '{"sentiment":"furious"}' }] },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: '{}' }] },
      { stop_reason: 'end_turn', content: [] },
    ];
    for (const response of cases) {
      const { suggester } = suggesterFor(() => response);
      expect(await suggester.suggest('Some reply')).toBeNull();
    }
  });

  it('swallows transport failures - a suggestion is optional, the poll is not', async () => {
    const { suggester } = suggesterFor(() => {
      throw new Error('ETIMEDOUT');
    });
    await expect(suggester.suggest('Some reply')).resolves.toBeNull();
  });
});
