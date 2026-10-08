// B8.1: raw RFC822 bytes → IncomingMessage, via mailparser. This is the ONLY
// place the real transport interprets a message; everything downstream (poller,
// classifier) already speaks IncomingMessage, so the offline header-fixture
// corpus (test/fixtures/headers/) is the same corpus this parser must satisfy.
//
// Two shapes matter (docs/07 §2):
//   - threading headers — in-reply-to / references drive the enrollment walk;
//   - DSNs — a multipart/report whose `message/delivery-status` part carries
//     Status + Final-Recipient. mailparser hands that part back as an
//     "attachment", NOT as `text`, so bodyText is rebuilt to include it (the
//     classifier greps Diagnostic-Code out of bodyText).
import {
  MailParser,
  type ParsedMail,
  type MessageText,
  type AttachmentStream,
  type Headers,
} from 'mailparser';
import type { Readable } from 'node:stream';
import type { IncomingMessage } from '../types';

export interface ParseContext {
  uid: number;
  mailboxId: number;
  /** Source folder (0012) — the UID is only meaningful alongside it. */
  folder?: string;
  uidValidity?: string;
  /** IMAP INTERNALDATE — more truthful than the sender's Date header. */
  internalDate?: Date;
}

const DELIVERY_STATUS = 'message/delivery-status';

export async function toIncomingMessage(
  source: Buffer | string,
  ctx: ParseContext,
): Promise<IncomingMessage> {
  const limit = 5 * 1024 * 1024;
  const parser = new MailParser({
    skipHtmlToText: false,
    skipTextToHtml: true,
    skipImageLinks: true,
    keepCidLinks: true,
    maxHtmlLengthToParse: limit,
  });
  let headerMap: Headers = new Map();
  let body: MessageText = { type: 'text' };
  let dsn = '';
  let hasDsn = false;
  let parseFailure: 'oversized' | 'unavailable' | null = null;
  const completed = new Promise<void>((resolve, reject) => {
    parser.on('headers', (value: Headers) => {
      headerMap = value;
    });
    parser.on('data', (part: MessageText | AttachmentStream) => {
      if (part.type === 'text') {
        body = part;
        return;
      }
      const delivery = part.contentType?.toLowerCase() === DELIVERY_STATUS;
      hasDsn ||= delivery;
      let bytes = 0;
      part.content.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (delivery && bytes <= 65536) dsn += chunk.toString('utf8');
      });
      part.content.on('error', reject);
      part.content.on('end', () => part.release());
      (part.content as Readable).resume();
    });
    parser.on('error', (error: Error) => {
      if (/^HTML too long for parsing/.test(error.message)) parseFailure = 'oversized';
      else if (error.message === 'Failed to parse HTML') parseFailure = 'unavailable';
      else reject(error);
    });
    parser.on('end', resolve);
  });
  parser.end(source);
  await completed;
  const rawHeaderLines =
    (parser as MailParser & { headerLines?: ParsedMail['headerLines'] }).headerLines ?? [];
  const parsed = {
    headers: headerMap,
    headerLines: rawHeaderLines,
    text: body.text,
    html: body.html,
    from: headerMap.get('from'),
    subject: headerMap.get('subject'),
    date: headerMap.get('date'),
    messageId: headerMap.get('message-id'),
    inReplyTo: headerMap.get('in-reply-to'),
    references: headerMap.get('references'),
  } as ParsedMail;
  const headers = headerRecord(parsed);
  if (rawHeaderLines.length === 0) {
    for (const [key, value] of headerMap) if (typeof value === 'string') headers[key] = value;
    // Structured content-type needs its raw MIME value for DSN detection.
    const contentType = headerMap.get('content-type') as
      { value?: string; params?: Record<string, string> } | undefined;
    if (contentType?.value)
      headers['content-type'] =
        `${contentType.value}; report-type=${contentType.params?.['report-type'] ?? ''}`;
  }
  const isDSN = /report-type=["']?delivery-status/i.test(headers['content-type'] ?? '') || hasDsn;

  let bodyText = [parsed.text ?? '', dsn].filter((s) => s.trim().length > 0).join('\n\n');
  let bodyHtml = typeof parsed.html === 'string' ? parsed.html : undefined;
  const oversized = Buffer.byteLength(bodyText) + Buffer.byteLength(bodyHtml ?? '') > limit;
  if (oversized || parseFailure) {
    bodyText = '';
    bodyHtml = undefined;
  }

  const references = normalizeReferences(parsed.references);

  const msg: IncomingMessage = {
    uid: ctx.uid,
    mailboxId: ctx.mailboxId,
    folder: ctx.folder ?? 'INBOX',
    uidValidity: ctx.uidValidity,
    from: addressOf(parsed),
    subject: parsed.subject ?? '',
    headers,
    bodyText,
    bodyHtml,
    contentStatus: parseFailure ?? (oversized ? 'oversized' : 'captured'),
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
