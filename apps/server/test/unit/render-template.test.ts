// B4.2/B4.4: tokenizer + validator + variation count (docs/08 §2).
import { describe, expect, it } from 'vitest';
import { parseTemplate, variationCount } from '../../src/render/template';

describe('parseTemplate', () => {
  it('plain text is a single text token', () => {
    expect(parseTemplate('Hi there.')).toEqual({
      tokens: [{ kind: 'text', value: 'Hi there.' }],
      errors: [],
    });
  });

  it('merge tag without fallback', () => {
    const { tokens, errors } = parseTemplate('Hi {{first_name}}!');
    expect(errors).toEqual([]);
    expect(tokens).toEqual([
      { kind: 'text', value: 'Hi ' },
      { kind: 'tag', field: 'first_name', fallback: null, offset: 3 },
      { kind: 'text', value: '!' },
    ]);
  });

  it('merge tag with fallback - fallback may itself contain pipes', () => {
    const { tokens } = parseTemplate('{{first_name|there|friend}}');
    expect(tokens).toEqual([
      { kind: 'tag', field: 'first_name', fallback: 'there|friend', offset: 0 },
    ]);
  });

  it('field names are trimmed', () => {
    const { tokens } = parseTemplate('{{ company | your team }}');
    expect(tokens[0]).toMatchObject({ kind: 'tag', field: 'company', fallback: ' your team ' });
  });

  it('spintax with 2+ options', () => {
    const { tokens, errors } = parseTemplate('{{RANDOM|Hey|Hi|Hello}} you');
    expect(errors).toEqual([]);
    expect(tokens[0]).toEqual({ kind: 'random', options: ['Hey', 'Hi', 'Hello'], offset: 0 });
  });

  it('spintax with <2 options is an error (check #2)', () => {
    expect(parseTemplate('{{RANDOM|only}}').errors).toEqual([
      { message: 'spintax needs at least 2 options', offset: 0 },
    ]);
    expect(parseTemplate('{{RANDOM}}').errors).toHaveLength(1);
  });

  it('escape \\{\\{ renders literal braces and is not parsed', () => {
    const { tokens, errors } = parseTemplate('use \\{\\{tags}} like this');
    expect(errors).toEqual([]);
    expect(tokens).toEqual([{ kind: 'text', value: 'use {{tags}} like this' }]);
  });

  it('unclosed tag is an error and the raw text stays visible', () => {
    const { tokens, errors } = parseTemplate('Hi {{first_name');
    expect(errors).toEqual([{ message: 'unclosed tag', offset: 3 }]);
    expect(tokens).toEqual([{ kind: 'text', value: 'Hi {{first_name' }]);
  });

  it('nested tags are an error (docs/08 §2)', () => {
    const { errors } = parseTemplate('{{RANDOM|a|{{company}}}}');
    expect(errors.some((e) => e.message.includes('nested'))).toBe(true);
  });

  it('empty merge tag is an error', () => {
    expect(parseTemplate('{{}}').errors).toEqual([{ message: 'empty merge tag', offset: 0 }]);
    expect(parseTemplate('{{|fallback}}').errors).toHaveLength(1);
  });

  it('lone braces are plain text', () => {
    expect(parseTemplate('a { b } c }}').errors).toEqual([]);
    expect(parseTemplate('a { b } c }}').tokens).toEqual([{ kind: 'text', value: 'a { b } c }}' }]);
  });
});

describe('variationCount (docs/08 §2)', () => {
  it('no spintax → 1', () => {
    expect(variationCount(parseTemplate('Hi {{first_name|there}}'))).toBe(1);
  });

  it('walkthrough opener: 2×3×2×2 = 24 across subject+body', () => {
    const subject = parseTemplate(
      '{{RANDOM|Quick question|Thought}} about {{company|your listings}}',
    );
    const body = parseTemplate(
      '{{RANDOM|Hey|Hi|Hello}} {{first_name|there}}, ' +
        '{{RANDOM|noticed|saw}} your listings - {{RANDOM|worth a chat|open to it}}?',
    );
    expect(variationCount(subject, body)).toBe(24);
  });
});
