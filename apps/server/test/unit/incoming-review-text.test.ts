import { expect, it } from 'vitest';
import { explicitOptOut, extractNewText } from '../../src/poller/reviewText';

it.each([
  'unsubscribe',
  'Please unsubscribe me.',
  'Remove me from your list',
  'Don’t contact me again.',
  'stop',
  'STOP. Please remove me from this list.',
])('protects direct request %s', (text) => {
  const extracted = extractNewText(text);
  expect(explicitOptOut(extracted.newText, extracted.uncertain)).toBeTruthy();
});
it.each([
  'Please stop by next week.',
  'I cannot stop thinking about this',
  'We use unsubscribe links',
  'He said "unsubscribe"',
  'Not interested',
  'I am away for three days. Please check back next week.',
])('holds ambiguous or unrelated wording %s', (text) => {
  const extracted = extractNewText(text);
  expect(explicitOptOut(extracted.newText, extracted.uncertain)).toBeNull();
});
it('excludes history and signatures without a 300-character detection limit', () => {
  for (const text of [
    'Hello\n\nOn Tuesday Sam wrote:\nunsubscribe',
    'Hello\n> unsubscribe',
    'Hello\n-- \nunsubscribe',
  ]) {
    const extracted = extractNewText(text);
    expect(explicitOptOut(extracted.newText)).toBeNull();
    expect(extracted.quotedText).toContain('unsubscribe');
  }
  expect(explicitOptOut('A'.repeat(350) + '.\nUnsubscribe')).toBeTruthy();
});
