// B3.2/B3.3: MockTransport scripting + synthetic inbound builders.
import { beforeEach, describe, expect, it } from 'vitest';
import { VirtualClock } from '../../src/clock/virtual';
import { MockTransport } from '../../src/transport/mock/mockTransport';
import {
  dsnBounce,
  oooReply,
  resetExternalMessageIds,
  threadedReply,
  unrelatedSpam,
} from '../../src/transport/mock/inbound';
import type { OutboundMessage } from '../../src/transport/types';

const msg = (to: string, messageId = `<m-${to}@ours.dev>`): OutboundMessage => ({
  mailboxId: 1,
  to,
  subject: 'Quick question',
  bodyText: 'Hi there',
  headers: { messageId },
});

describe('MockTransport', () => {
  let clock: VirtualClock;
  let mock: MockTransport;

  beforeEach(() => {
    clock = new VirtualClock('2026-01-05T09:00:00Z');
    mock = new MockTransport(clock);
    resetExternalMessageIds();
  });

  it('accepts by default, echoing the app-generated Message-ID', async () => {
    const r = await mock.send(msg('a@x.dev', '<mid-1@ours.dev>'));
    expect(r).toEqual({ messageId: '<mid-1@ours.dev>', accepted: true });
    expect(mock.sentLog).toHaveLength(1);
    expect(mock.sentLog[0]!.at).toEqual(clock.now());
  });

  it('scripted outcomes apply FIFO per recipient, then fall back to accept', async () => {
    mock.onSend('a@x.dev', { kind: 'transient' });
    mock.onSend('a@x.dev', { kind: 'permanent_recipient' });

    const r1 = await mock.send(msg('a@x.dev'));
    expect(r1.accepted).toBe(false);
    expect(r1.transientError).toMatch(/^421/);
    expect(r1.errorScope).toBeUndefined();

    const r2 = await mock.send(msg('a@x.dev'));
    expect(r2.accepted).toBe(false);
    expect(r2.permanentError).toMatch(/^550 5\.1\.1/);
    expect(r2.errorScope).toBe('recipient');

    const r3 = await mock.send(msg('a@x.dev'));
    expect(r3.accepted).toBe(true);

    // other recipients unaffected
    expect((await mock.send(msg('b@x.dev'))).accepted).toBe(true);
  });

  it('permanent_mailbox is scoped to the mailbox (auth failure)', async () => {
    mock.onSend('a@x.dev', { kind: 'permanent_mailbox' });
    const r = await mock.send(msg('a@x.dev'));
    expect(r.errorScope).toBe('mailbox');
    expect(r.permanentError).toMatch(/^535/);
  });

  it('queueInbound assigns ascending UIDs per mailbox; fetchNew drains', async () => {
    const at = clock.now();
    const u1 = mock.queueInbound(1, unrelatedSpam({ from: 's@spam.net', receivedAt: at }));
    const u2 = mock.queueInbound(1, unrelatedSpam({ from: 's@spam.net', receivedAt: at }));
    const u3 = mock.queueInbound(2, unrelatedSpam({ from: 's@spam.net', receivedAt: at }));
    expect([u1, u2, u3]).toEqual([1, 2, 1]); // per-mailbox counters

    const batch1 = await mock.fetchNew(1);
    expect(batch1.map((m) => m.uid)).toEqual([1, 2]);
    expect(batch1[0]!.mailboxId).toBe(1);
    expect(await mock.fetchNew(1)).toEqual([]); // drained
    expect((await mock.fetchNew(2)).map((m) => m.uid)).toEqual([1]);
  });

  it('an explicit uid simulates duplicate delivery of the same message', async () => {
    const at = clock.now();
    mock.queueInbound(1, unrelatedSpam({ from: 's@spam.net', receivedAt: at }));
    await mock.fetchNew(1);
    mock.queueInbound(1, { ...unrelatedSpam({ from: 's@spam.net', receivedAt: at }), uid: 1 });
    expect((await mock.fetchNew(1)).map((m) => m.uid)).toEqual([1]);
  });

  it('verify is scripted per fromAddress with an OK default', async () => {
    mock.onVerify('mb1@x.dev', { smtpOk: true, imapOk: false, error: 'IMAP login failed' });
    const bad = await mock.verify({
      smtpHost: 'smtp.x.dev',
      smtpPort: 587,
      imapHost: 'imap.x.dev',
      imapPort: 993,
      fromAddress: 'mb1@x.dev',
      password: 'pw',
    });
    expect(bad.imapOk).toBe(false);
    const ok = await mock.verify({
      smtpHost: 'smtp.x.dev',
      smtpPort: 587,
      imapHost: 'imap.x.dev',
      imapPort: 993,
      fromAddress: 'mb2@x.dev',
      password: 'pw',
    });
    expect(ok).toMatchObject({ smtpOk: true, imapOk: true });
  });

  it('sentTo/lastSentTo see only accepted sends', async () => {
    mock.onSend('a@x.dev', { kind: 'transient' });
    await mock.send(msg('a@x.dev', '<t1@ours.dev>'));
    await mock.send(msg('a@x.dev', '<t2@ours.dev>'));
    expect(mock.sentTo('a@x.dev')).toHaveLength(1);
    expect(mock.lastSentTo('a@x.dev')!.msg.headers.messageId).toBe('<t2@ours.dev>');
  });
});

describe('synthetic inbound builders (real header shapes, docs/07 §6)', () => {
  const at = new Date('2026-01-07T15:00:00Z');

  beforeEach(() => resetExternalMessageIds());

  it('threadedReply carries In-Reply-To + References pointing at our Message-ID', () => {
    const r = threadedReply({
      from: 'lead@x.dev',
      bodyText: 'Interested, tell me more.',
      receivedAt: at,
      inReplyTo: '<sent-42@ours.dev>',
    });
    expect(r.inReplyTo).toBe('<sent-42@ours.dev>');
    expect(r.references).toEqual(['<sent-42@ours.dev>']);
    expect(r.headers['in-reply-to']).toBe('<sent-42@ours.dev>');
    expect(r.isDSN).toBe(false);
    expect(r.messageId).toMatch(/^<synthetic-1@/);
  });

  it('referencesOnly drops In-Reply-To but keeps the References chain', () => {
    const r = threadedReply({
      from: 'lead@x.dev',
      bodyText: 'ok',
      receivedAt: at,
      inReplyTo: '<sent-1@ours.dev>',
      references: ['<sent-1@ours.dev>', '<sent-2@ours.dev>'],
      referencesOnly: true,
    });
    expect(r.inReplyTo).toBeUndefined();
    expect(r.headers['in-reply-to']).toBeUndefined();
    expect(r.references).toEqual(['<sent-1@ours.dev>', '<sent-2@ours.dev>']);
  });

  it('dsnBounce has the multipart/report shape with Status + Final-Recipient', () => {
    const d = dsnBounce({ recipient: 'gone@x.dev', status: '5.1.1', receivedAt: at });
    expect(d.isDSN).toBe(true);
    expect(d.dsnStatus).toBe('5.1.1');
    expect(d.dsnRecipient).toBe('gone@x.dev');
    expect(d.from).toMatch(/^mailer-daemon@/);
    expect(d.headers['content-type']).toMatch(/report-type=delivery-status/);
    expect(d.bodyText).toMatch(/Final-Recipient: rfc822; gone@x\.dev/);
    expect(d.bodyText).toMatch(/Status: 5\.1\.1/);
  });

  it('soft DSN uses a 4.x status and full-mailbox diagnostic', () => {
    const d = dsnBounce({ recipient: 'full@x.dev', status: '4.2.2', receivedAt: at });
    expect(d.dsnStatus).toBe('4.2.2');
    expect(d.bodyText).toMatch(/inbox is full/);
  });

  it('oooReply sets Auto-Submitted: auto-replied and may thread', () => {
    const o = oooReply({ from: 'away@x.dev', receivedAt: at, inReplyTo: '<sent-9@ours.dev>' });
    expect(o.headers['auto-submitted']).toBe('auto-replied');
    expect(o.inReplyTo).toBe('<sent-9@ours.dev>');
    expect(o.isDSN).toBe(false);
  });

  it('unrelatedSpam has no threading headers at all', () => {
    const s = unrelatedSpam({ from: 'seo@spam.net', receivedAt: at });
    expect(s.inReplyTo).toBeUndefined();
    expect(s.references).toBeUndefined();
    expect(s.headers['in-reply-to']).toBeUndefined();
    expect(s.isDSN).toBe(false);
  });
});
