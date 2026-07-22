// B3.12: STOP / opt-out matcher (decision F, docs/07 §§3,7). Pure unit tests.
import { describe, expect, it } from 'vitest';
import { detectStop, unquotedText } from '../../src/poller/stopMatcher';

describe('unquotedText', () => {
  it('strips >-quoted lines, "On … wrote:" intros, and signatures after --', () => {
    const body = [
      'Remove me please.',
      '',
      '--',
      'Dave Wilson | Wilson Properties',
      'On Mon, Jan 5, 2026 at 9:02 AM Arjun wrote:',
      '> Hi Dave, quick question…',
    ].join('\n');
    expect(unquotedText(body)).toBe('Remove me please.');
  });

  it('stops at the Outlook underscore separator', () => {
    const body = ['Not interested.', '________________________________', 'From: Arjun'].join('\n');
    expect(unquotedText(body)).toBe('Not interested.');
  });

  it('keyword hiding only in the QUOTED part never matches', () => {
    const body = ['Thanks, sounds good!', '> Reply STOP and I will remove you immediately.'].join(
      '\n',
    );
    expect(detectStop(body)).toEqual({ matched: false });
  });
});

describe('detectStop - positives', () => {
  it.each([
    ['STOP', 'stop'],
    ['Stop.', 'stop'],
    ['Please stop', 'stop'],
    ['stop emailing me', 'stop'],
    ['Please remove me from your list.', 'remove me'],
    ['unsubscribe', 'unsubscribe'],
    ['Take me off this list now', 'take me off'],
    ['I want to opt out of these emails', 'opt out'],
    ['Opt me out please', 'opt me out'],
    ['Do not email me again.', 'do not email me'],
    ['do not contact me', 'do not contact me'],
    ['We no longer email vendors, please no longer contact us - remove me.', 'no longer email'],
  ])('"%s" → matched (%s)', (text, keyword) => {
    expect(detectStop(text)).toEqual({ matched: true, keyword });
  });

  it('a stronger phrase rescues a text where bare "stop" alone would fail', () => {
    const text =
      'We should stop switching vendors all the time, honestly. Anyway please unsubscribe me from this list.';
    expect(detectStop(text)).toEqual({ matched: true, keyword: 'unsubscribe' });
  });
});

describe('detectStop - negatives (the false-positive traps)', () => {
  it.each([
    ['we should stop losing leads to slow photo turnaround'], // the docs/07 example
    ['Can you stop by our office next week to discuss?'],
    ['Our one-stop shop handles all listings.'], // "one-stop" - \b matches "stop"? hyphen boundary
    ['We put a stop order on new vendor spend this quarter, but ping me in Q3.'],
    ['Thanks, interested - send pricing.'],
  ])('"%s" → not matched', (text) => {
    expect(detectStop(text).matched).toBe(false);
  });

  it('bare "stop" beyond 40 words of text never matches', () => {
    const filler = Array.from({ length: 45 }, (_, i) => `word${i}`).join(' ');
    expect(detectStop(`${filler}. STOP`).matched).toBe(false);
  });

  it('keyword outside the first 300 chars never matches', () => {
    const padding = 'a'.repeat(310);
    expect(detectStop(`${padding} unsubscribe`).matched).toBe(false);
  });
});
