// B3.3: the test/fixtures/headers/ corpus parses into classifier-ready
// IncomingMessage shapes. The classifier itself is exercised over these in
// B3.11's tests — here we lock the fixtures' load-bearing fields.
import { describe, expect, it } from 'vitest';
import { ALL_FIXTURES, loadHeaderFixture } from '../helpers/emlFixtures';

describe('headers/ fixture corpus', () => {
  it('every fixture loads with from, subject, message-id and a body', () => {
    for (const name of ALL_FIXTURES) {
      const m = loadHeaderFixture(name);
      expect(m.from, name).toMatch(/@/);
      expect(m.subject, name).not.toBe('');
      expect(m.messageId, name).toMatch(/^<.+>$/);
      expect(m.bodyText.length, name).toBeGreaterThan(0);
    }
  });

  it.each([
    ['gmail-dsn-5xx', '5.1.1', 'john.smith@acmerealty.com', 'mailer-daemon@googlemail.com'],
    ['gmail-dsn-4xx', '4.2.2', 'maria.garcia@sunsethomes.com', 'mailer-daemon@googlemail.com'],
    ['outlook-dsn', '5.1.10', 'sarah.jones@contoso.com', 'postmaster@outlook.com'],
  ] as const)('%s is a DSN: status %s for %s', (name, status, recipient, from) => {
    const m = loadHeaderFixture(name);
    expect(m.isDSN).toBe(true);
    expect(m.dsnStatus).toBe(status);
    expect(m.dsnRecipient).toBe(recipient);
    expect(m.from).toBe(from);
  });

  it.each([['gmail-vacation'], ['outlook-autoreply']] as const)(
    '%s is auto-submitted and threads back to our send',
    (name) => {
      const m = loadHeaderFixture(name);
      expect(m.isDSN).toBe(false);
      expect(m.headers['auto-submitted']).toBe('auto-replied');
      expect(m.inReplyTo).toMatch(/^<fixture-sent-\d@ourdomain\.com>$/);
    },
  );

  it('reply-in-reply-to threads via In-Reply-To', () => {
    const m = loadHeaderFixture('reply-in-reply-to');
    expect(m.inReplyTo).toBe('<fixture-sent-3@ourdomain.com>');
    expect(m.references).toEqual(['<fixture-sent-3@ourdomain.com>']);
    expect(m.headers['auto-submitted']).toBeUndefined();
  });

  it('reply-references-only has no In-Reply-To but a multi-id References chain', () => {
    const m = loadHeaderFixture('reply-references-only');
    expect(m.inReplyTo).toBeUndefined();
    expect(m.references).toEqual([
      '<fixture-sent-4@ourdomain.com>',
      '<fixture-sent-5@ourdomain.com>',
    ]);
  });

  it('forwarded reply with changed subject still carries our id inside References', () => {
    const m = loadHeaderFixture('reply-forwarded-subject-changed');
    expect(m.subject).not.toMatch(/^Re:/i);
    expect(m.inReplyTo).toBeUndefined();
    expect(m.references).toContain('<fixture-sent-6@ourdomain.com>');
  });

  it('spam-unrelated has no threading headers and is not a DSN', () => {
    const m = loadHeaderFixture('spam-unrelated');
    expect(m.isDSN).toBe(false);
    expect(m.inReplyTo).toBeUndefined();
    expect(m.references).toBeUndefined();
    expect(m.headers['auto-submitted']).toBeUndefined();
  });

  it('folded headers unfold (gmail 5xx diagnostic spans lines)', () => {
    const m = loadHeaderFixture('gmail-dsn-5xx');
    expect(m.headers['content-type']).toMatch(/boundary="000000000000ab12cd"/);
  });
});
