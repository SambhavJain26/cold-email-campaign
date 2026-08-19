// B8.1: SMTP failure → the three branches docs/06 §5 defines. This is pure, so
// the mapping is unit-testable against the error shapes nodemailer really
// throws (code/responseCode/response), without a server.
//
//   4b transient          → nothing appended, retried next tick
//   4c permanent recipient→ hard_bounce on the LEAD
//   4c permanent mailbox  → mailbox auth_failed; unassigned work rotates
//
// The default is TRANSIENT on purpose: an unrecognised failure must never
// terminal a lead as hard-bounced — retrying a live address is cheap, wrongly
// burning one is not.

export type SmtpFailure =
  | { kind: 'transient'; error: string }
  | { kind: 'permanent'; scope: 'recipient' | 'mailbox'; error: string };

interface NodemailerErrorish {
  code?: string;
  responseCode?: number;
  response?: string;
  command?: string;
  message?: string;
}

/** Connection-level codes nodemailer raises before/around the SMTP dialogue. */
const TRANSIENT_CODES = new Set([
  'ECONNECTION',
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ESOCKET',
  'EDNS',
  'EAGAIN',
  'EPIPE',
  'EHOSTUNREACH',
  'ENETUNREACH',
]);

/** Envelope/message-level codes: the 5xx came from RCPT TO / DATA, i.e. the recipient. */
const RECIPIENT_CODES = new Set(['EENVELOPE', 'EMESSAGE']);

export function classifySmtpError(err: unknown): SmtpFailure {
  const e = (err ?? {}) as NodemailerErrorish;
  const error = describe(e);
  const code = e.code;
  const status = e.responseCode;

  // A 4xx is transient whatever raised it — including AUTH (rate-limited
  // logins answer 4xx) and greylisting at RCPT time.
  if (status !== undefined && status >= 400 && status < 500) return { kind: 'transient', error };

  if (code !== undefined && TRANSIENT_CODES.has(code)) return { kind: 'transient', error };

  if (status !== undefined && status >= 500) {
    if (code !== undefined && RECIPIENT_CODES.has(code)) {
      return { kind: 'permanent', scope: 'recipient', error };
    }
    // 5xx from AUTH, or any other 5xx we can't attribute to the address: the
    // mailbox is the broken thing (auth_failed; do not reroute started threads).
    return { kind: 'permanent', scope: 'mailbox', error };
  }

  if (code === 'EAUTH') return { kind: 'permanent', scope: 'mailbox', error };

  return { kind: 'transient', error };
}

/** True when a rejection came back on a resolved sendMail (partial rejection). */
export function rejectionError(rejectedErrors: unknown): SmtpFailure {
  const first = Array.isArray(rejectedErrors) ? rejectedErrors[0] : undefined;
  if (first === undefined) return { kind: 'permanent', scope: 'recipient', error: 'rejected' };
  const classified = classifySmtpError(first);
  // A rejected RECIPIENT is by definition recipient-scoped when permanent.
  if (classified.kind === 'permanent') {
    return { kind: 'permanent', scope: 'recipient', error: classified.error };
  }
  return classified;
}

function describe(e: NodemailerErrorish): string {
  const text = (e.response ?? e.message ?? 'smtp failure').toString().trim();
  const prefix = e.responseCode !== undefined ? `${e.responseCode} ` : '';
  return text.startsWith(String(e.responseCode ?? '')) ? text : `${prefix}${text}`.trim();
}
