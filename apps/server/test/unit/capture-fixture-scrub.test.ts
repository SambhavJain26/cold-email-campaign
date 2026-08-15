// capture-fixture's privacy guarantees (docs/17 §4). These are pure functions
// on purpose: the tool talks to real IMAP, so without this the only way to
// check a scrub is to run it against a live mailbox and read the output — which
// is exactly how it stayed broken from the day it was written until 2026-08-16.
import { describe, expect, it } from 'vitest';
import { joinSoftBreaks, scrub, stripQuoted } from '../ops/capture-fixture';

const OWN = 'canary@ourmailbox.test';

describe('stripQuoted', () => {
  it('removes a plain-text quoted reply and its attribution', () => {
    const { text, removed } = stripQuoted(
      [
        'received',
        '',
        'On Thu, Aug 13, 2026 at 11:24 PM Someone <a@b.test> wrote:',
        '> Hi Real Name,',
        '> regards',
        '> Real Name',
      ].join('\n'),
    );
    expect(text).toContain('received');
    expect(text).not.toContain('Real Name');
    expect(removed).toBeGreaterThan(0);
  });

  it('truncates the HTML part at the quote marker, keeping the reply above it', () => {
    // Gmail's HTML part is ONE long line once soft breaks are joined, so a
    // line-wise drop would delete the reply too.
    const line =
      '<div dir="ltr">received</div><div class="gmail_quote"><p>Hi Real Name,</p><p>Real Name</p></div>';
    const { text } = stripQuoted(line);
    expect(text).toContain('received');
    expect(text).not.toContain('Real Name');
    expect(text).toContain('[quoted original removed]');
  });

  it('a MIME boundary ends the quoted region', () => {
    const { text } = stripQuoted(
      ['> quoted line', '--boundary42', 'Content-Type: text/html', '', 'kept'].join('\n'),
    );
    expect(text).toContain('--boundary42');
    expect(text).toContain('Content-Type: text/html');
    expect(text).toContain('kept');
  });

  it('leaves a DSN alone — its payload is not a quoted block', () => {
    const dsn = [
      'Content-Type: message/delivery-status',
      '',
      'Final-Recipient: rfc822; ghost@nowhere.test',
      'Action: failed',
      'Status: 5.1.1',
    ].join('\n');
    const { text, removed } = stripQuoted(dsn);
    expect(removed).toBe(0);
    expect(text).toContain('Status: 5.1.1');
    expect(text).toContain('Final-Recipient: rfc822; ghost@nowhere.test');
  });
});

describe('header structure survives scrubbing', () => {
  it('keeps the From/To header LABELS — swallowing them loses the sender', () => {
    // The lazy name capture will eat `From: ` if `:` is allowed in it, leaving
    // a fixture with no From header at all — the one field the classifier
    // reads to identify a sender.
    const { text } = scrub('From: Real Person <someone@personal.test>\nTo: Me <x@y.test>', OWN);
    expect(text).toMatch(/^From: /m);
    expect(text).toMatch(/^To: /m);
    expect(text).not.toContain('Real Person');
  });

  it('strips a soft-broken attribution line once breaks are joined', () => {
    const raw = 'received\n\nOn Thu, Aug 13 at 11:24 PM Someone <a@b.test> wro=\r\nte:\n> Hi\n';
    const { text } = stripQuoted(joinSoftBreaks(raw));
    expect(text).toContain('received');
    expect(text).not.toMatch(/wrote:/);
  });
});

describe('scrub', () => {
  it('rewrites addresses and the display names attached to them', () => {
    const { text } = scrub(`From: Real Person <someone@personal.test>\nTo: Me <${OWN}>`, OWN);
    expect(text).not.toContain('someone@personal.test');
    expect(text).not.toContain('Real Person');
    expect(text).toContain('arjun@ourdomain.com'); // our own mailbox's placeholder
  });

  it('catches an address split by a quoted-printable soft break', () => {
    // The bug that made the privacy guarantee silently fail on most real mail:
    // ADDRESS_RE never matched across the `=\r\n`, so neither did the guard.
    const { text } = scrub('contact me at someone@perso=\r\nnal.test today', OWN);
    expect(text).not.toContain('personal.test');
  });

  it('preserves provider identities the classifier matches on', () => {
    const { text } = scrub('From: mailer-daemon@googlemail.com\nTo: postmaster@x.test', OWN);
    expect(text).toContain('mailer-daemon@googlemail.com');
    expect(text).toContain('postmaster@x.test');
  });

  it('preserves OUR Message-ID shape — the threading anchor', () => {
    // Rewriting this to an address shape destroys the exact string the
    // In-Reply-To → stored-Message-ID matcher keys on.
    const { text } = scrub('In-Reply-To: <ce-5-1-1786643649013@gmail.com>', OWN);
    expect(text).toContain('<ce-5-1-1786643649013@gmail.com>');
  });

  it("preserves Gmail's Message-ID host", () => {
    const { text } = scrub('Message-ID: <CAHV47ngSeY@mail.gmail.com>', OWN);
    expect(text).toContain('@mail.gmail.com');
  });
});
