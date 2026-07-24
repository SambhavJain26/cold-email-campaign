// docs/16 §3: the locked-out recovery path. `ensureOperator` seeds the row ONCE,
// so editing OPERATOR_INITIAL_PASSWORD afterwards does nothing - without this
// CLI a forgotten password can only be fixed by hand-editing the database.
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { createDb, type Db } from '../../src/db/client';
import { ensureOperator, verifyPassword } from '../../src/services/operatorAuth';
import { getOperator } from '../../src/db/repos/operatorRepo';
import { main } from '../../src/services/operatorSetPasswordCli';
import { TEST_DATABASE_URL, resetCoreTables } from '../helpers/db';

const OPERATOR = { OPERATOR_EMAIL: 'op@test.dev', OPERATOR_INITIAL_PASSWORD: 'initial-password' };

describe('operator:set-password CLI', () => {
  let db: Db;
  let pool: Pool;

  beforeEach(async () => {
    ({ db, pool } = createDb(TEST_DATABASE_URL));
    await resetCoreTables(pool);
    // The CLI loads its own config from the environment.
    vi.stubEnv('DATABASE_URL', TEST_DATABASE_URL);
    vi.stubEnv('SECRET_KEY', 'ab'.repeat(32));
    vi.stubEnv('SESSION_KEY', 'cd'.repeat(32));
    vi.stubEnv('OPERATOR_EMAIL', OPERATOR.OPERATOR_EMAIL);
    vi.stubEnv('OPERATOR_INITIAL_PASSWORD', OPERATOR.OPERATOR_INITIAL_PASSWORD);
    vi.stubEnv('NODE_ENV', 'test');
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    await resetCoreTables(pool);
    await pool.end();
  });

  const hashOf = async (): Promise<string> => (await getOperator(db))!.passwordHash;

  it('replaces the stored hash so the new password logs in and the old one does not', async () => {
    await ensureOperator(db, OPERATOR);
    const before = await hashOf();

    expect(await main(['--password', 'a-brand-new-password'])).toBe(0);

    const after = await hashOf();
    expect(after).not.toBe(before);
    expect(after.startsWith('$argon2id$')).toBe(true); // hashed, never plaintext
    expect(await verifyPassword(after, 'a-brand-new-password')).toBe(true);
    expect(await verifyPassword(after, OPERATOR.OPERATOR_INITIAL_PASSWORD)).toBe(false);
  });

  it('accepts the password from NEW_PASSWORD (keeps it out of shell history)', async () => {
    await ensureOperator(db, OPERATOR);
    vi.stubEnv('NEW_PASSWORD', 'from-the-environment');

    expect(await main([])).toBe(0);

    expect(await verifyPassword(await hashOf(), 'from-the-environment')).toBe(true);
    vi.stubEnv('NEW_PASSWORD', '');
  });

  it('refuses a missing or too-short password, and an unseeded database', async () => {
    await ensureOperator(db, OPERATOR);
    const unchanged = await hashOf();

    expect(await main([])).toBe(1); // no --password, no NEW_PASSWORD
    expect(await main(['--password', 'short'])).toBe(1);
    expect(await hashOf()).toBe(unchanged);

    await resetCoreTables(pool); // no operator row yet
    expect(await main(['--password', 'a-brand-new-password'])).toBe(1);
  });
});
