import { describe, expect, it } from 'vitest';
import { parseEnv } from '../../src/config/env';

const validEnv = {
  DATABASE_URL: 'postgres://coldemail:pw@localhost:5433/coldemail',
  SECRET_KEY: 'a'.repeat(64),
  SESSION_KEY: 'b'.repeat(64),
  OPERATOR_EMAIL: 'op@example.com',
  OPERATOR_INITIAL_PASSWORD: 'longenough',
};

describe('parseEnv', () => {
  it('accepts a minimal valid env and applies defaults', () => {
    const r = parseEnv(validEnv);
    if (!r.success) throw new Error(r.issues.join('; '));
    expect(r.config.MAIL_TRANSPORT).toBe('mock');
    expect(r.config.ROLE).toBe('all');
    expect(r.config.PORT).toBe(3001);
    expect(r.config.HOST).toBe('127.0.0.1');
    expect(r.config.NODE_ENV).toBe('production');
  });

  it('coerces PORT to a number', () => {
    const r = parseEnv({ ...validEnv, PORT: '8080' });
    if (!r.success) throw new Error(r.issues.join('; '));
    expect(r.config.PORT).toBe(8080);
  });

  it('rejects a short SECRET_KEY with a pointed message', () => {
    const r = parseEnv({ ...validEnv, SECRET_KEY: 'deadbeef' });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.issues.some((i) => i.startsWith('SECRET_KEY'))).toBe(true);
  });

  it('treats empty strings as unset (missing required reported)', () => {
    const r = parseEnv({ ...validEnv, DATABASE_URL: '' });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.issues.some((i) => i.startsWith('DATABASE_URL'))).toBe(true);
  });

  it('lists every problem at once, not just the first', () => {
    const r = parseEnv({});
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.issues.length).toBeGreaterThanOrEqual(5);
  });

  it('rejects invalid MAIL_TRANSPORT values', () => {
    const r = parseEnv({ ...validEnv, MAIL_TRANSPORT: 'sendgrid' });
    expect(r.success).toBe(false);
  });

  // ── B8.1: the live transport's TLS escape hatch ───────────────────────────

  it('MAIL_TLS_INSECURE defaults off and is refused in production', () => {
    const off = parseEnv(validEnv);
    expect(off.success && off.config.MAIL_TLS_INSECURE).toBe(false);

    const dev = parseEnv({ ...validEnv, MAIL_TLS_INSECURE: 'true', NODE_ENV: 'test' });
    expect(dev.success && dev.config.MAIL_TLS_INSECURE).toBe(true);

    // Plaintext/unverified TLS to a real provider would put the mailbox
    // password on the wire - the flag exists for the local GreenMail rig only.
    const prod = parseEnv({
      ...validEnv,
      MAIL_TLS_INSECURE: 'true',
      NODE_ENV: 'production',
      MAIL_TRANSPORT: 'smtp_imap',
    });
    expect(prod.success).toBe(false);
    if (prod.success) return;
    expect(prod.issues.some((i) => i.startsWith('MAIL_TLS_INSECURE'))).toBe(true);
  });

  it('refuses a simulated clock against the live transport (burst-send guard)', () => {
    const r = parseEnv({ ...validEnv, SIMULATED_CLOCK: 'true', MAIL_TRANSPORT: 'smtp_imap' });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.issues.some((i) => i.startsWith('SIMULATED_CLOCK'))).toBe(true);
  });
});
