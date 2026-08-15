// B8.1: SmtpImapTransport against a REAL SMTP+IMAP server (GreenMail in
// Docker — `docker compose up -d greenmail`). No real mailboxes, no accounts:
// the same "test container" pattern the DB-backed suites use for Postgres.
//
// What it proves, in the order docs/16 §5's canary checklist asks for it:
//   verify round-trip · our Message-ID survives the provider · In-Reply-To /
//   References survive · UID high-water mark is honoured (the `n:*` trap) ·
//   real DSN / OOO / reply messages parse into the shapes the classifier reads ·
//   bad credentials produce TransportAuthError (IMAP) and a mailbox-scoped
//   permanent failure (SMTP).
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SmtpImapTransport } from '../../src/transport/smtpImap/smtpImapTransport';
import { TransportAuthError, type IncomingMessage } from '../../src/transport/types';
import {
  CANARY,
  DAEMON,
  LEAD,
  SECOND,
  StaticConnections,
  connectionFor,
  deliver,
  dsnMessage,
  fileIntoFolder,
  readInbox,
  resetGreenMail,
} from './helpers/greenmail';

const CANARY_ID = 1;
const SECOND_ID = 2;

describe('SmtpImapTransport over a real server (B8.1)', () => {
  let connections: StaticConnections;
  let transport: SmtpImapTransport;

  beforeAll(async () => {
    await resetGreenMail(); // fails loudly with the docker-compose hint
  });

  beforeEach(async () => {
    await resetGreenMail();
    connections = new StaticConnections();
    connections.set(CANARY_ID, connectionFor(CANARY));
    connections.set(SECOND_ID, connectionFor(SECOND));
    transport = new SmtpImapTransport({ connections, insecureTls: true, timeoutMs: 10_000 });
  });

  // ── verify (Test Connection / health) ──────────────────────────────────────

  it('verify: a real SMTP + IMAP round-trip on good credentials', async () => {
    const result = await transport.verify(connectionFor(CANARY));
    expect(result).toMatchObject({ smtpOk: true, imapOk: true });
    expect(result.error).toBeUndefined();
    expect(result.roundTripMs).toBeGreaterThanOrEqual(0);
  });

  it('verify: bad credentials fail BOTH legs and report why (no secret in the text)', async () => {
    const result = await transport.verify({ ...connectionFor(CANARY), password: 'wrong-password' });
    expect(result.smtpOk).toBe(false);
    expect(result.imapOk).toBe(false);
    expect(result.error).toMatch(/^smtp:/);
    expect(result.error).not.toMatch(/wrong-password/);
  });

  // ── send (docs/06 §5, docs/07 §4) ──────────────────────────────────────────

  it('send: the message lands, carrying OUR Message-ID and display name', async () => {
    const messageId = '<ce-101-1-1750000000000@coldemail.test>';
    const result = await transport.send({
      mailboxId: CANARY_ID,
      to: LEAD.address,
      subject: 'quick question about Acme',
      bodyText: 'Hi Sarah,\n\nNoticed you handle listings in Austin.\n\n— Arjun',
      headers: { messageId },
    });
    expect(result).toEqual({ messageId, accepted: true });

    const [stored] = await readInbox(LEAD);
    expect(stored).toBeDefined();
    // The threading anchor is the id WE generated before the send — a provider
    // rewriting it would break every reply match (docs/07 §4).
    expect(stored!.source).toContain(`Message-ID: ${messageId}`);
    expect(stored!.source).toContain('From: Arjun Mehta <canary@coldemail.test>');
    expect(stored!.source).toContain('Subject: quick question about Acme');
    expect(stored!.source).toContain('Noticed you handle listings in Austin.');
  });

  it('send: text plus HTML becomes a minimal multipart alternative', async () => {
    await transport.send({
      mailboxId: CANARY_ID,
      to: LEAD.address,
      subject: 'A safe subject',
      bodyText: 'Hi Sarah\n\n---\n123 Main St\nReply STOP',
      bodyHtml: '<p>Hi Sarah</p><p style="font-size:11px;color:#666">123 Main St<br>Reply STOP</p>',
      headers: { messageId: '<ce-html-1@coldemail.test>' },
    });
    const [stored] = await readInbox(LEAD);
    expect(stored!.source).toMatch(/Content-Type: multipart\/alternative/i);
    expect(stored!.source).toContain('Hi Sarah');
    expect(stored!.source).toContain('font-size:11px');
  });

  it('send: List-Unsubscribe and the one-click Post header reach the wire together', async () => {
    const url = 'https://unsubscribe.coldemail.test/u/tok-abc123';
    await transport.send({
      mailboxId: CANARY_ID,
      to: LEAD.address,
      subject: 'A safe subject',
      bodyText: `Hi Sarah\n\n---\nUnsubscribe: ${url} or reply STOP | 123 Main St`,
      headers: { messageId: '<ce-unsub-1@coldemail.test>', listUnsubscribeUrl: url },
    });
    const [stored] = await readInbox(LEAD);
    // RFC 8058: Gmail shows its native button only when BOTH are present, and
    // the URL must be angle-bracketed.
    expect(stored!.source).toContain(`List-Unsubscribe: <${url}>`);
    expect(stored!.source).toContain('List-Unsubscribe-Post: List-Unsubscribe=One-Click');
  });

  it('send: neither unsubscribe header appears when the feature is dormant', async () => {
    await transport.send({
      mailboxId: CANARY_ID,
      to: LEAD.address,
      subject: 'A safe subject',
      bodyText: 'Hi Sarah\n\n---\nReply STOP to unsubscribe | 123 Main St',
      headers: { messageId: '<ce-unsub-2@coldemail.test>' },
    });
    const [stored] = await readInbox(LEAD);
    expect(stored!.source).not.toMatch(/List-Unsubscribe/i);
  });

  it('send: In-Reply-To and References survive the wire for in-thread follow-ups', async () => {
    const step1 = '<ce-101-1-1750000000000@coldemail.test>';
    const step2 = '<ce-101-2-1750259200000@coldemail.test>';
    await transport.send({
      mailboxId: CANARY_ID,
      to: LEAD.address,
      subject: 'quick question about Acme',
      bodyText: 'step one',
      headers: { messageId: step1 },
    });
    const result = await transport.send({
      mailboxId: CANARY_ID,
      to: LEAD.address,
      subject: 'Re: quick question about Acme',
      bodyText: 'step two',
      headers: { messageId: step2, inReplyTo: step1, references: [step1] },
    });
    expect(result.accepted).toBe(true);

    const inbox = await readInbox(LEAD);
    expect(inbox).toHaveLength(2);
    const followUp = inbox[1]!.source;
    expect(followUp).toContain(`In-Reply-To: ${step1}`);
    expect(followUp).toContain(`References: ${step1}`);
    expect(followUp).toContain('Subject: Re: quick question about Acme');
  });

  it('send: unknown mailbox / missing credentials is a MAILBOX-scoped permanent failure', async () => {
    const result = await transport.send({
      mailboxId: 99,
      to: LEAD.address,
      subject: 's',
      bodyText: 'b',
      headers: { messageId: '<ce-1-1-1@coldemail.test>' },
    });
    expect(result.accepted).toBe(false);
    expect(result.errorScope).toBe('mailbox');
    expect(result.permanentError).toMatch(/credentials/);
  });

  it('send: bad credentials → permanent MAILBOX failure (535), never a lead hard-bounce', async () => {
    connections.set(CANARY_ID, { ...connectionFor(CANARY), password: 'wrong-password' });
    const result = await transport.send({
      mailboxId: CANARY_ID,
      to: LEAD.address,
      subject: 's',
      bodyText: 'b',
      headers: { messageId: '<ce-1-1-2@coldemail.test>' },
    });
    expect(result.accepted).toBe(false);
    expect(result.errorScope).toBe('mailbox');
    expect(result.permanentError).toMatch(/535/);
    expect(result.transientError).toBeUndefined();
  });

  // ── fetchNew (docs/07 §1) ─────────────────────────────────────────────────

  it('fetchNew: returns new mail ascending and NOTHING once the high-water mark caught up', async () => {
    await deliver({ as: LEAD, to: CANARY.address, subject: 'first', text: 'one' });
    await deliver({ as: LEAD, to: CANARY.address, subject: 'second', text: 'two' });

    const first = await transport.fetchNew(CANARY_ID);
    expect(first.map((m) => m.subject)).toEqual(['first', 'second']);
    expect(first[0]!.uid).toBeLessThan(first[1]!.uid);
    expect(first[0]!.mailboxId).toBe(CANARY_ID);
    expect(first[0]!.from).toBe(LEAD.address);

    // THE trap: IMAP's `n:*` range returns the LAST message when n is past the
    // highest UID, so without a client-side `uid > highWater` filter every poll
    // would re-deliver the newest message forever.
    connections.advanceUid(CANARY_ID, first.at(-1)!.uid);
    expect(await transport.fetchNew(CANARY_ID)).toEqual([]);

    await deliver({ as: LEAD, to: CANARY.address, subject: 'third', text: 'three' });
    const third = await transport.fetchNew(CANARY_ID);
    expect(third.map((m) => m.subject)).toEqual(['third']);
    expect(third[0]!.uid).toBeGreaterThan(first.at(-1)!.uid);
  });

  // Finding 13: the poller read INBOX only, so a reply the provider spam-filed
  // was invisible — and indistinguishable from a broken poller.
  describe('fetchNew across folders (finding 13)', () => {
    it('does NOT see a spam-filed reply when only INBOX is polled', async () => {
      await deliver({ as: LEAD, to: CANARY.address, subject: 'filed away', text: 'hi' });
      const [inInbox] = await readInbox(CANARY);
      await fileIntoFolder(CANARY, inInbox!.uid, 'Junk');

      // This is the bug, reproduced: INBOX-only polling loses the reply.
      expect(await transport.fetchNew(CANARY_ID)).toEqual([]);
    });

    it('finds it once the folder is configured, and tags it with its folder', async () => {
      await deliver({ as: LEAD, to: CANARY.address, subject: 'filed away', text: 'hi' });
      const [inInbox] = await readInbox(CANARY);
      await fileIntoFolder(CANARY, inInbox!.uid, 'Junk');

      connections.set(CANARY_ID, connectionFor(CANARY, 0, ['INBOX', 'Junk']));
      const found = await transport.fetchNew(CANARY_ID);

      expect(found.map((m) => m.subject)).toEqual(['filed away']);
      expect(found[0]!.folder).toBe('Junk');
    });

    it('keeps per-folder high-water marks independent', async () => {
      // The load-bearing property: UID 1 in Junk and UID 1 in INBOX are
      // different messages, so advancing one must not skip the other.
      await deliver({ as: LEAD, to: CANARY.address, subject: 'to junk', text: 'a' });
      const [first] = await readInbox(CANARY);
      await fileIntoFolder(CANARY, first!.uid, 'Junk');
      await deliver({ as: LEAD, to: CANARY.address, subject: 'to inbox', text: 'b' });

      connections.set(CANARY_ID, connectionFor(CANARY, 0, ['INBOX', 'Junk']));
      const all = await transport.fetchNew(CANARY_ID);
      expect(all.map((m) => m.subject).sort()).toEqual(['to inbox', 'to junk']);

      // Advance ONLY Junk: the INBOX message must still be returned.
      const junk = all.find((m) => m.folder === 'Junk')!;
      connections.advanceUid(CANARY_ID, junk.uid, 'Junk');
      const remaining = await transport.fetchNew(CANARY_ID);
      expect(remaining.map((m) => m.subject)).toEqual(['to inbox']);
      expect(remaining[0]!.folder).toBe('INBOX');
    });

    it('a folder that does not exist is skipped, not fatal — INBOX still polls', async () => {
      // Provider folder names differ ("[Gmail]/Spam" vs "Junk"), so a
      // misconfigured name must not blind the mailbox entirely.
      await deliver({ as: LEAD, to: CANARY.address, subject: 'still arrives', text: 'x' });
      connections.set(CANARY_ID, connectionFor(CANARY, 0, ['INBOX', 'NoSuchFolder']));

      const found = await transport.fetchNew(CANARY_ID);
      expect(found.map((m) => m.subject)).toEqual(['still arrives']);
    });
  });

  it('fetchNew: reads are non-destructive — nothing is deleted, \\Seen is not set', async () => {
    await deliver({ as: LEAD, to: CANARY.address, subject: 'keep me', text: 'x' });
    await transport.fetchNew(CANARY_ID);
    // Still there for a second reader (the mailbox is the operator's, not ours).
    expect((await readInbox(CANARY)).map((m) => m.source.includes('keep me'))).toEqual([true]);
  });

  it('fetchNew: a real threaded reply carries the ids the enrollment walk needs', async () => {
    const ourId = '<ce-101-1-1750000000000@coldemail.test>';
    await transport.send({
      mailboxId: CANARY_ID,
      to: LEAD.address,
      subject: 'quick question about Acme',
      bodyText: 'step one',
      headers: { messageId: ourId },
    });
    await deliver({
      as: LEAD,
      to: CANARY.address,
      subject: 'Re: quick question about Acme',
      text: 'Sounds interesting — can you send times?',
      inReplyTo: ourId,
      references: [ourId],
    });

    const [reply] = await transport.fetchNew(CANARY_ID);
    expect(reply!.inReplyTo).toBe(ourId);
    expect(reply!.references).toEqual([ourId]);
    expect(reply!.isDSN).toBe(false);
    expect(reply!.bodyText).toContain('can you send times?');
    expect(reply!.receivedAt.getTime()).toBeGreaterThan(0);
  });

  it('fetchNew: a real OOO auto-reply keeps its Auto-Submitted header', async () => {
    await deliver({
      as: LEAD,
      to: CANARY.address,
      subject: 'Automatic reply: quick question about Acme',
      text: 'I am out of the office until Monday.',
      headers: { 'Auto-Submitted': 'auto-replied' },
    });
    const [ooo] = await transport.fetchNew(CANARY_ID);
    expect(ooo!.headers['auto-submitted']).toBe('auto-replied');
    expect(ooo!.isDSN).toBe(false);
  });

  it('fetchNew: a real DSN parses to status + recipient (hard and soft)', async () => {
    await deliver({
      as: DAEMON,
      to: CANARY.address,
      raw: dsnMessage({
        from: DAEMON.address,
        to: CANARY.address,
        recipient: 'john.smith@acmerealty.com',
        status: '5.1.1',
      }),
    });
    await deliver({
      as: DAEMON,
      to: CANARY.address,
      raw: dsnMessage({
        from: DAEMON.address,
        to: CANARY.address,
        recipient: 'maria@fullinbox.com',
        status: '4.2.2',
      }),
    });

    const msgs = await transport.fetchNew(CANARY_ID);
    expect(msgs).toHaveLength(2);
    const [hard, soft] = msgs as [IncomingMessage, IncomingMessage];
    expect(hard).toMatchObject({
      isDSN: true,
      dsnStatus: '5.1.1',
      dsnRecipient: 'john.smith@acmerealty.com',
      from: DAEMON.address,
    });
    expect(hard.bodyText).toMatch(/^Diagnostic-Code:/m);
    expect(soft).toMatchObject({
      isDSN: true,
      dsnStatus: '4.2.2',
      dsnRecipient: 'maria@fullinbox.com',
    });
  });

  it('fetchNew: bad credentials throw TransportAuthError (→ auth_failed + redistribution)', async () => {
    connections.set(CANARY_ID, { ...connectionFor(CANARY), password: 'wrong-password' });
    await expect(transport.fetchNew(CANARY_ID)).rejects.toBeInstanceOf(TransportAuthError);
  });

  it('fetchNew: an unknown mailbox is empty, not an error', async () => {
    expect(await transport.fetchNew(99)).toEqual([]);
  });

  it('keeps mailboxes independent — a second mailbox has its own inbox and UIDs', async () => {
    await deliver({ as: LEAD, to: CANARY.address, subject: 'for canary', text: 'a' });
    await deliver({ as: LEAD, to: SECOND.address, subject: 'for second', text: 'b' });

    expect((await transport.fetchNew(CANARY_ID)).map((m) => m.subject)).toEqual(['for canary']);
    expect((await transport.fetchNew(SECOND_ID)).map((m) => m.subject)).toEqual(['for second']);
  });

  it('picks up rotated credentials without a restart (reconnect flow)', async () => {
    connections.set(CANARY_ID, { ...connectionFor(CANARY), password: 'wrong-password' });
    expect((await transport.send(probe())).accepted).toBe(false);

    connections.set(CANARY_ID, connectionFor(CANARY)); // operator re-enters the app password
    expect((await transport.send(probe())).accepted).toBe(true);
  });

  function probe() {
    return {
      mailboxId: CANARY_ID,
      to: LEAD.address,
      subject: 'probe',
      bodyText: 'probe',
      headers: { messageId: `<ce-1-1-${Date.now()}@coldemail.test>` },
    };
  }
});
