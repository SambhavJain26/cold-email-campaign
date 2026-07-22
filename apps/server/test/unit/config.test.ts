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
    expect(r.config.PORT).toBe(3000);
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
});
