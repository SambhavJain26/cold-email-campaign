import { describe, expect, it } from 'vitest';
import { imapAuthFor, smtpAuthFor } from '../../src/transport/smtpImap/smtpImapTransport';

const oauth = {
  smtpHost: 'smtp.gmail.com',
  smtpPort: 587,
  imapHost: 'imap.gmail.com',
  imapPort: 993,
  fromAddress: 'sender@example.com',
  authType: 'google_oauth' as const,
  accessToken: 'memory-only-token',
};

describe('Google OAuth transport authentication', () => {
  it('uses Nodemailer OAuth2 rather than a password', () => {
    expect(smtpAuthFor(oauth)).toEqual({
      type: 'OAuth2',
      user: 'sender@example.com',
      accessToken: 'memory-only-token',
    });
    expect(smtpAuthFor(oauth)).not.toHaveProperty('pass');
  });

  it('uses the IMAP SASL access token rather than a password', () => {
    expect(imapAuthFor(oauth)).toEqual({
      user: 'sender@example.com',
      accessToken: 'memory-only-token',
    });
    expect(imapAuthFor(oauth)).not.toHaveProperty('pass');
  });
});
