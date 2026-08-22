// SECRET_KEY rotation (B7.1; runbook docs/16 §3). Decrypts every mailbox
// secret with the OLD key and re-seals it under the NEW key inside ONE
// transaction — either the whole set moves to the new key or nothing does,
// so a crash mid-rotation can never leave a mix the app can't unseal.
import type { Db } from '../db/client';
import { listMailboxSecrets, upsertMailboxSecret } from '../db/repos/mailboxesRepo';
import { listOauthSecrets, replaceOauthSecret } from '../db/repos/mailboxOauthRepo';
import { sealSecret, unsealSecret } from '../secrets/seal';

const HEX_KEY_32 = /^[0-9a-f]{64}$/i;

export interface RotateSecretsResult {
  rotated: number;
}

/**
 * Re-seal all mailbox secrets from `oldKey` to `newKey` in a single tx.
 * Throws before touching a row if the keys are malformed or identical, or if
 * any secret fails to unseal with `oldKey` (wrong old key / tampered blob) —
 * a partial rotation is never committed.
 */
export async function rotateSecrets(
  db: Db,
  oldKey: string,
  newKey: string,
  now: Date,
): Promise<RotateSecretsResult> {
  if (!HEX_KEY_32.test(oldKey)) throw new Error('old key must be 32 bytes as 64 hex chars');
  if (!HEX_KEY_32.test(newKey)) throw new Error('new key must be 32 bytes as 64 hex chars');
  if (oldKey.toLowerCase() === newKey.toLowerCase()) {
    throw new Error('new key is identical to the current key — nothing to rotate');
  }

  return db.transaction(async (tx) => {
    const secrets = await listMailboxSecrets(tx);
    for (const { mailboxId, sealed } of secrets) {
      // Unseal throws on a wrong old key or tampered blob — aborting the tx
      // before any row is rewritten (all-or-nothing).
      const plaintext = await unsealSecret(sealed, oldKey);
      const resealed = await sealSecret(plaintext, newKey);
      await upsertMailboxSecret(tx, mailboxId, resealed, now);
    }
    const oauthSecrets = await listOauthSecrets(tx);
    for (const secret of oauthSecrets) {
      const plaintext = await unsealSecret(secret.sealed, oldKey);
      const resealed = await sealSecret(plaintext, newKey);
      await replaceOauthSecret(
        tx,
        secret.kind === 'refresh'
          ? { kind: 'refresh', mailboxId: secret.mailboxId, sealed: resealed, at: now }
          : { kind: 'pkce', stateHash: secret.stateHash, sealed: resealed },
      );
    }
    return { rotated: secrets.length + oauthSecrets.length };
  });
}
