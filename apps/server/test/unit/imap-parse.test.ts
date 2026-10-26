// B8.1: the real parser (mailparser) over the real-world header corpus
// (docs/13 §2). The offline suites feed the classifier through the hand-rolled
// `loadHeaderFixture` loader; B8 replaces that loader with mailparser in
// production, so the two MUST agree on every field the classifier reads - 
// otherwise the whole offline classifier suite is testing a fiction.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { toIncomingMessage } from '../../src/transport/smtpImap/parse';
import { ALL_FIXTURES, loadHeaderFixture, type FixtureName } from '../helpers/emlFixtures';

const FIXTURES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/headers');

function raw(name: FixtureName): Buffer {
  return readFileSync(path.join(FIXTURES_DIR, `${name}.eml`));
}

describe('mailparser → IncomingMessage (B8.1)', () => {
  it.each(ALL_FIXTURES)('%s: agrees with the offline fixture loader', async (name) => {
    const parsed = await toIncomingMessage(raw(name), { uid: 7, mailboxId: 3 });
    const offline = loadHeaderFixture(name);

    expect(parsed.uid).toBe(7);
    expect(parsed.mailboxId).toBe(3);
    expect(parsed.from).toBe(offline.from);
    expect(parsed.subject).toBe(offline.subject);
    expect(parsed.messageId).toBe(offline.messageId);
    expect(parsed.inReplyTo).toBe(offline.inReplyTo);
    expect(parsed.references).toEqual(offline.references);
    expect(parsed.isDSN).toBe(offline.isDSN);
    expect(parsed.dsnStatus).toBe(offline.dsnStatus);
    expect(parsed.dsnRecipient).toBe(offline.dsnRecipient);
    expect(parsed.receivedAt.toISOString()).toBe(offline.receivedAt.toISOString());
  });

  it('pulls Status/Final-Recipient out of the message/delivery-status PART, not the text part', async () => {
    // mailparser hands the delivery-status part back as an attachment - if the
    // parser only looked at `text`, every DSN would classify as unparseable.
    const m = await toIncomingMessage(raw('gmail-dsn-5xx'), { uid: 1, mailboxId: 1 });
    expect(m.isDSN).toBe(true);
    expect(m.dsnStatus).toBe('5.1.1');
    expect(m.dsnRecipient).toBe('john.smith@acmerealty.com');
    // bodyText carries BOTH parts - the classifier greps Diagnostic-Code from it.
    expect(m.bodyText).toMatch(/Address not found/);
    expect(m.bodyText).toMatch(/^Diagnostic-Code:/m);
  });

  it('keeps a soft DSN soft (4.x.x) and reads the Outlook variant', async () => {
    expect(
      (await toIncomingMessage(raw('gmail-dsn-4xx'), { uid: 1, mailboxId: 1 })).dsnStatus,
    ).toBe('4.2.2');
    const outlook = await toIncomingMessage(raw('outlook-dsn'), { uid: 1, mailboxId: 1 });
    expect(outlook.isDSN).toBe(true);
    expect(outlook.dsnStatus?.startsWith('5')).toBe(true);
  });

  it('preserves the threading headers the enrollment walk needs', async () => {
    const direct = await toIncomingMessage(raw('reply-in-reply-to'), { uid: 1, mailboxId: 1 });
    expect(direct.inReplyTo).toMatch(/^<.+>$/);
    expect(direct.references?.at(-1)).toBe(direct.inReplyTo);

    // Outlook-ism: References only, no In-Reply-To - the walk must still match.
    const refsOnly = await toIncomingMessage(raw('reply-references-only'), {
      uid: 1,
      mailboxId: 1,
    });
    expect(refsOnly.inReplyTo).toBeUndefined();
    expect(refsOnly.references?.length).toBeGreaterThan(0);

    // Forwarded with a changed subject - subject is NEVER the matcher, the
    // References chain is (docs/07 §4).
    const forwarded = await toIncomingMessage(raw('reply-forwarded-subject-changed'), {
      uid: 1,
      mailboxId: 1,
    });
    expect(forwarded.references?.length).toBeGreaterThan(0);
  });

  it('lowercases header names and unfolds continuations (the classifier reads this map)', async () => {
    const ooo = await toIncomingMessage(raw('gmail-vacation'), { uid: 1, mailboxId: 1 });
    expect(ooo.headers['auto-submitted']).toBe('auto-replied');
    expect(ooo.isDSN).toBe(false);

    const outlook = await toIncomingMessage(raw('outlook-autoreply'), { uid: 1, mailboxId: 1 });
    expect(
      outlook.headers['auto-submitted'] ?? outlook.headers['x-auto-response-suppress'],
    ).toBeDefined();
  });

  it('prefers the IMAP INTERNALDATE over the sender-supplied Date header', async () => {
    const internalDate = new Date('2026-03-03T10:00:00Z');
    const m = await toIncomingMessage(raw('spam-unrelated'), {
      uid: 1,
      mailboxId: 1,
      internalDate,
    });
    expect(m.receivedAt.toISOString()).toBe(internalDate.toISOString());
    expect(m.isDSN).toBe(false);
    expect(m.inReplyTo).toBeUndefined();
    expect(m.references).toBeUndefined();
  });
});
