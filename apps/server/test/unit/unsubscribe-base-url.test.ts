import { describe, expect, it } from 'vitest';
import { resolveUnsubscribeBaseUrl } from '../../src/services/unsubscribeBaseUrl';

describe('resolveUnsubscribeBaseUrl', () => {
  it('selects the unsubscribe host from the sending mailbox domain', () => {
    expect(
      resolveUnsubscribeBaseUrl('https://unsubscribe.{sender_domain}', 'hello@SambhavPMTech.com'),
    ).toBe('https://unsubscribe.sambhavpmtech.com');
    expect(
      resolveUnsubscribeBaseUrl('https://unsubscribe.{sender_domain}', 'hello@sambhavpmops.com'),
    ).toBe('https://unsubscribe.sambhavpmops.com');
  });

  it('keeps a fixed legacy unsubscribe base URL unchanged', () => {
    expect(resolveUnsubscribeBaseUrl('https://unsubscribe.example.com', 'a@example.org')).toBe(
      'https://unsubscribe.example.com',
    );
  });

  it('rejects an invalid sender address rather than generating an unsafe URL', () => {
    expect(() =>
      resolveUnsubscribeBaseUrl('https://unsubscribe.{sender_domain}', 'not-an-address'),
    ).toThrow('sender mailbox has no domain');
  });
});
