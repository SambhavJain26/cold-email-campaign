// B8.1: raw RFC822 bytes → IncomingMessage, via mailparser. This is the ONLY
// place the real transport interprets a message; everything downstream (poller,
// classifier) already speaks IncomingMessage, so the offline header-fixture
// corpus (test/fixtures/headers/) is the same corpus this parser must satisfy.
//
// Two shapes matter (docs/07 §2):
//   - threading headers - in-reply-to / references drive the enrollment walk;
//   - DSNs - a multipart/report whose `message/delivery-status` part carries
//     Status + Final-Recipient. mailparser hands that part back as an
//     "attachment", NOT as `text`, so bodyText is rebuilt to include it (the
//     classifier greps Diagnostic-Code out of bodyText).
import { simpleParser, type ParsedMail } from 'mailparser';
import type { IncomingMessage } from '../types';

export interface ParseContext {
  uid: number;
  mailboxId: number;
  /** IMAP INTERNALDATE - more truthful than the sender's Date header. */
  internalDate?: Date;
}

const DELIVERY_STATUS = 'message/delivery-status';

export async function toIncomingMessage(
  source: Buffer | string,
  ctx: ParseContext,
): Promise<IncomingMessage> {
  const parsed = await simpleParser(source, { skipHtmlToText: true, skipImageLinks: true });
  const headers = headerRecord(parsed);

  const deliveryStatus = parsed.attachments.find(
    (a) => a.contentType?.toLowerCase() === DELIVERY_STATUS,
  );
  const isDSN =
    /report-type=["']?delivery-status/i.test(headers['content-type'] ?? '') ||
    deliveryStatus !== undefined;

  const bodyText = [parsed.text ?? '', deliveryStatus?.content.toString('utf8') ?? '']
    .filter((s) => s.trim().length > 0)
    .join('\n\n');

  const references = normalizeReferences(parsed.references);

  const msg: IncomingMessage = {
    uid: ctx.uid,
    mailboxId: ctx.mailboxId,
    from: addressOf(parsed),
    subject: parsed.subject ?? '',
    headers,
    bodyText,
    isDSN,
    receivedAt: ctx.internalDate ?? parsed.date ?? new Date(),
  };
  if (parsed.messageId) msg.messageId = parsed.messageId;
  if (parsed.inReplyTo) msg.inReplyTo = firstMessageId(parsed.inReplyTo);
  if (references) msg.references = references;

  if (isDSN) {
    const status = /^Status:\s*([\d]+\.[\d]+\.[\d]+)/im.exec(bodyText)?.[1];
    const recipient =
      /^(?:Final|Original)-Recipient:\s*[^;]+;\s*(\S+)/im.exec(bodyText)?.[1] ??
      /^(?:Final|Original)-Recipient:\s*(\S+@\S+)/im.exec(bodyText)?.[1];
    if (status) msg.dsnStatus = status;
    if (recipient) msg.dsnRecipient = stripAngles(recipient).toLowerCase();
  }

  return msg;
}

/** Lowercased header names → unfolded values (the shape the classifier reads). */
function headerRecord(parsed: ParsedMail): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const { key, line } of parsed.headerLines) {
    const value = line.slice(line.indexOf(':') + 1);
    headers[key.toLowerCase()] = value.replace(/\r?\n[ \t]+/g, ' ').trim();
  }
  return headers;
}

function addressOf(parsed: ParsedMail): string {
  const address = parsed.from?.value[0]?.address;
  return (address ?? '').trim().toLowerCase();
}

/** mailparser hands back a string or a string[]; angle brackets are kept. */
function normalizeReferences(refs: string | string[] | undefined): string[] | undefined {
  if (!refs) return undefined;
  const ids = (Array.isArray(refs) ? refs.join(' ') : refs).match(/<[^>]+>/g);
  return ids ?? undefined;
}

function firstMessageId(value: string): string {
  return value.match(/<[^>]+>/)?.[0] ?? value.trim();
}

function stripAngles(value: string): string {
  return value.replace(/^<|>$/g, '');
}
