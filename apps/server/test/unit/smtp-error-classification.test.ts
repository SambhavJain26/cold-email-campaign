// B8.1: the SMTP failure branches (docs/06 §5) mapped from the error shapes
// nodemailer really throws. Pure - no server needed; the live GreenMail suite
// proves the 535/EAUTH shape is real, this suite proves every branch.
import { describe, expect, it } from 'vitest';
import { classifySmtpError, rejectionError } from '../../src/transport/smtpImap/errors';

/** The shape nodemailer attaches to SMTP errors. */
function smtpError(fields: {
  code?: string;
  responseCode?: number;
  response?: string;
  command?: string;
}): Error {
  return Object.assign(new Error(fields.response ?? 'smtp error'), fields);
}

describe('classifySmtpError (B8.1)', () => {
  it('4xx is transient whatever raised it - greylisting retries, never a bounce', () => {
    const greylist = classifySmtpError(
      smtpError({
        code: 'EENVELOPE',
        responseCode: 450,
        response: '450 4.2.0 Recipient deferred, try again later',
        command: 'RCPT TO',
      }),
    );
    expect(greylist).toEqual({
      kind: 'transient',
      error: '450 4.2.0 Recipient deferred, try again later',
    });

    // A rate-limited AUTH answers 4xx - the mailbox is fine, the moment isn't.
    expect(
      classifySmtpError(
        smtpError({
          code: 'EAUTH',
          responseCode: 454,
          response: '454 4.7.0 Too many login attempts',
        }),
      ).kind,
    ).toBe('transient');
  });

  it('5xx at RCPT/DATA is a permanent RECIPIENT failure → hard_bounce', () => {
    expect(
      classifySmtpError(
        smtpError({
          code: 'EENVELOPE',
          responseCode: 550,
          response: '550 5.1.1 The email account that you tried to reach does not exist',
          command: 'RCPT TO',
        }),
      ),
    ).toEqual({
      kind: 'permanent',
      scope: 'recipient',
      error: '550 5.1.1 The email account that you tried to reach does not exist',
    });

    expect(
      classifySmtpError(
        smtpError({
          code: 'EMESSAGE',
          responseCode: 552,
          response: '552 5.2.3 Message too large',
        }).valueOf(),
      ).kind,
    ).toBe('permanent');
  });

  it('bad credentials are a permanent MAILBOX failure → auth_failed + redistribution', () => {
    // The exact shape GreenMail/Gmail return (asserted live in the mail suite).
    expect(
      classifySmtpError(
        smtpError({
          code: 'EAUTH',
          responseCode: 535,
          response: '535 5.7.8 Authentication credentials invalid',
          command: 'AUTH PLAIN',
        }),
      ),
    ).toEqual({
      kind: 'permanent',
      scope: 'mailbox',
      error: '535 5.7.8 Authentication credentials invalid',
    });

    // An EAUTH with no numeric response still scopes to the mailbox.
    expect(classifySmtpError(smtpError({ code: 'EAUTH' }))).toMatchObject({
      kind: 'permanent',
      scope: 'mailbox',
    });
  });

  it('an unattributable 5xx blames the mailbox, not the lead', () => {
    // 550 relay-denied is a sending-side policy problem; burning the lead as
    // hard-bounced would be wrong.
    expect(
      classifySmtpError(
        smtpError({
          responseCode: 550,
          response: '550 5.7.1 Relaying denied',
          command: 'MAIL FROM',
        }),
      ),
    ).toEqual({ kind: 'permanent', scope: 'mailbox', error: '550 5.7.1 Relaying denied' });
  });

  it('connection-level failures are transient', () => {
    for (const code of ['ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'EDNS', 'ECONNRESET']) {
      expect(classifySmtpError(smtpError({ code })).kind).toBe('transient');
    }
  });

  it('an unrecognised failure defaults to TRANSIENT (never terminal a lead on a guess)', () => {
    expect(classifySmtpError(new Error('something weird')).kind).toBe('transient');
    expect(classifySmtpError(undefined).kind).toBe('transient');
    expect(classifySmtpError('a string').kind).toBe('transient');
  });

  it('a resolved send carrying a rejected recipient maps to recipient-permanent', () => {
    expect(
      rejectionError([
        smtpError({ responseCode: 550, response: '550 5.1.1 unknown', command: 'RCPT TO' }),
      ]),
    ).toEqual({ kind: 'permanent', scope: 'recipient', error: '550 5.1.1 unknown' });

    // …but a 4xx rejection is still just a retry.
    expect(
      rejectionError([smtpError({ responseCode: 451, response: '451 4.3.0 deferred' })]).kind,
    ).toBe('transient');

    // No detail at all: the address was refused, that's all we know.
    expect(rejectionError(undefined)).toEqual({
      kind: 'permanent',
      scope: 'recipient',
      error: 'rejected',
    });
  });
});
