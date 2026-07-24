// B7.1 — SECRET_KEY rotation (runbook docs/16 §3). Proves re-sealing moves
// every secret to the new key atomically, and that the guards refuse a bad or
// no-op rotation before touching a row.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../../src/db/client';
import { getMailboxSecret, upsertMailboxSecret } from '../../src/db/repos/mailboxesRepo';
import { sealSecret, unsealSecret } from '../../src/secrets/seal';
import { rotateSecrets } from '../../src/services/rotateSecrets';
import { resetCoreTables, seedMailboxes, TEST_DATABASE_URL } from '../helpers/db';

const KEY_A = 'a1'.repeat(32);
const KEY_B = 'b2'.repeat(32);
const NOW = new Date('2026-07-24T00:00:00Z');

const { db, pool } = createDb(TEST_DATABASE_URL);

async function seal(mailboxId: number, plaintext: string, key: string): Promise<void> {
  await upsertMailboxSecret(db, mailboxId, await sealSecret(plaintext, key), NOW);
}

describe('B7.1 rotateSecrets', () => {
  beforeEach(async () => {
    await resetCoreTables(pool);
    await seedMailboxes(pool, 3);
  });
  afterAll(async () => {
    await pool.end();
  });

  it('re-seals every secret from old key to new key; new key unseals, old key no longer does', async () => {
    await seal(1, 'pw-one', KEY_A);
    await seal(2, 'pw-two', KEY_A);
    await seal(3, 'pw-three', KEY_A);

    const { rotated } = await rotateSecrets(db, KEY_A, KEY_B, NOW);
    expect(rotated).toBe(3);

    for (const [id, pw] of [
      [1, 'pw-one'],
      [2, 'pw-two'],
      [3, 'pw-three'],
    ] as const) {
      const sealed = await getMailboxSecret(db, id);
      expect(await unsealSecret(sealed!, KEY_B)).toBe(pw); // new key works
      await expect(unsealSecret(sealed!, KEY_A)).rejects.toThrow(); // old key is dead
    }
  });

  it('is a no-op count over zero secrets (no mailboxes with creds yet)', async () => {
    const { rotated } = await rotateSecrets(db, KEY_A, KEY_B, NOW);
    expect(rotated).toBe(0);
  });

  it('rejects an identical new key without touching anything', async () => {
    await seal(1, 'pw-one', KEY_A);
    await expect(rotateSecrets(db, KEY_A, KEY_A, NOW)).rejects.toThrow(/identical/);
    // untouched: still unseals with the original key
    expect(await unsealSecret((await getMailboxSecret(db, 1))!, KEY_A)).toBe('pw-one');
  });

  it('rejects a malformed key', async () => {
    await expect(rotateSecrets(db, KEY_A, 'not-hex', NOW)).rejects.toThrow(/64 hex/);
    await expect(rotateSecrets(db, 'short', KEY_B, NOW)).rejects.toThrow(/64 hex/);
  });

  it('aborts the whole rotation (all-or-nothing) if the old key is wrong', async () => {
    await seal(1, 'pw-one', KEY_A);
    await seal(2, 'pw-two', KEY_A);
    const WRONG_OLD = 'cc'.repeat(32);

    await expect(rotateSecrets(db, WRONG_OLD, KEY_B, NOW)).rejects.toThrow();

    // tx rolled back: both still sealed under the real old key, none under B
    expect(await unsealSecret((await getMailboxSecret(db, 1))!, KEY_A)).toBe('pw-one');
    expect(await unsealSecret((await getMailboxSecret(db, 2))!, KEY_A)).toBe('pw-two');
  });
});
