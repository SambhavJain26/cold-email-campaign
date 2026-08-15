// Loads the test/fixtures/headers/ corpus (docs/13 §2) into IncomingMessage
// shapes — the minimal, test-only stand-in for what mailparser does inside
// SmtpImapTransport at B8. Header unfolding + DSN part extraction only; if a
// fixture needs more than this, the fixture is probably too clever.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SynthesizedMessage } from '../../src/transport/types';

const FIXTURES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/headers');

export type FixtureName =
  | 'gmail-dsn-5xx'
  | 'gmail-dsn-4xx'
  | 'outlook-dsn'
  | 'gmail-vacation'
  | 'outlook-autoreply'
  | 'reply-in-reply-to'
  | 'reply-references-only'
  | 'reply-forwarded-subject-changed'
  | 'spam-unrelated'
  | 'gmail-real-reply';

export const ALL_FIXTURES: FixtureName[] = [
  'gmail-dsn-5xx',
  'gmail-dsn-4xx',
  'outlook-dsn',
  'gmail-vacation',
  'outlook-autoreply',
  'reply-in-reply-to',
  'reply-references-only',
  'reply-forwarded-subject-changed',
  'spam-unrelated',
  // Captured from a REAL Gmail reply (2026-08-16) -- wording and header shapes
  // are Google's, not our guess at them.
  'gmail-real-reply',
];

/** Parse RFC822-style headers with continuation-line unfolding. */
function parseHeaders(raw: string): Record<string, string> {
  const headers: Record<string, string> = {};
  let currentKey: string | null = null;
  for (const line of raw.split(/\r?\n/)) {
    if (/^[ \t]/.test(line) && currentKey) {
      headers[currentKey] += ` ${line.trim()}`;
    } else {
      const m = /^([!-9;-~]+):\s*(.*)$/.exec(line);
      if (m) {
        currentKey = m[1]!.toLowerCase();
        headers[currentKey] = m[2]!;
      }
    }
  }
  return headers;
}

/** Extract the bare address from a From header ("Name <a@b>" or "a@b"). */
function addressOf(from: string): string {
  const m = /<([^>]+)>/.exec(from);
  return (m ? m[1]! : from).trim().toLowerCase();
}

function splitReferences(refs: string | undefined): string[] | undefined {
  if (!refs) return undefined;
  const ids = refs.match(/<[^>]+>/g);
  return ids ?? undefined;
}

export function loadHeaderFixture(name: FixtureName): SynthesizedMessage {
  const raw = readFileSync(path.join(FIXTURES_DIR, `${name}.eml`), 'utf8');
  const splitAt = raw.indexOf('\n\n');
  const headerBlock = splitAt === -1 ? raw : raw.slice(0, splitAt);
  const body = splitAt === -1 ? '' : raw.slice(splitAt + 2);
  const headers = parseHeaders(headerBlock);

  const contentType = headers['content-type'] ?? '';
  const isDSN = /report-type=delivery-status/i.test(contentType);

  let dsnStatus: string | undefined;
  let dsnRecipient: string | undefined;
  if (isDSN) {
    dsnStatus = /^Status:\s*([\d.]+)/im.exec(body)?.[1];
    const finalRecipient = /^Final-Recipient:\s*rfc822;\s*(\S+)/im.exec(body)?.[1];
    dsnRecipient = finalRecipient?.toLowerCase();
  }

  return {
    from: addressOf(headers['from'] ?? ''),
    subject: headers['subject'] ?? '',
    headers,
    bodyText: body,
    messageId: headers['message-id'],
    inReplyTo: headers['in-reply-to'],
    references: splitReferences(headers['references']),
    isDSN,
    dsnStatus,
    dsnRecipient,
    receivedAt: headers['date'] ? new Date(headers['date']) : new Date(0),
  };
}
