import { expect, it } from 'vitest';
import { toIncomingMessage } from '../../src/transport/smtpImap/parse';

it('captures HTML-only mail with readable text and preserves paragraphs', async () => {
  const m = await toIncomingMessage(
    'From: Lead <lead@example.com>\r\nSubject: Hello\r\nMessage-ID: <html@example.com>\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<p>Hello there.</p><p>Please check next week.</p><img src="https://tracker.example/pixel">',
    { uid: 1, mailboxId: 1, folder: 'Spam', uidValidity: '12' },
  );
  expect(m.bodyText).toContain('Hello there.');
  expect(m.bodyText).toContain('Please check next week.');
  expect(m.bodyHtml).toContain('<p>');
  expect(m.uidValidity).toBe('12');
  expect(m.contentStatus).toBe('captured');
});
it('marks oversized decoded content without retaining a partial body', async () => {
  const m = await toIncomingMessage(
    'From: lead@example.com\r\nContent-Type: text/plain\r\n\r\n' + 'x'.repeat(5 * 1024 * 1024 + 1),
    { uid: 1, mailboxId: 1 },
  );
  expect(m.contentStatus).toBe('oversized');
  expect(m.bodyText).toBe('');
  expect(m.bodyHtml).toBeUndefined();
});
it('oversized HTML-only mail does not poison the polling cursor', async () => {
  const m = await toIncomingMessage(
    'From: lead@example.com\r\nContent-Type: text/html\r\n\r\n<p>' +
      'x'.repeat(5 * 1024 * 1024 + 1) +
      '</p>',
    { uid: 1, mailboxId: 1 },
  );
  expect(m.contentStatus).toBe('oversized');
  expect(m.bodyText).toBe('');
  expect(m.bodyHtml).toBeUndefined();
});
