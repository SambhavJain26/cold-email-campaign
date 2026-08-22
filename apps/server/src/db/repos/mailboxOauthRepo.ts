import { and, eq, gt, isNull } from 'drizzle-orm';
import type { Db, DbLike } from '../client';
import { mailboxOauthCredentials, mailboxOauthStates } from '../schema';

export interface OauthCredentialRow {
  sealedRefreshToken: Buffer;
  grantedEmail: string;
  scopes: string[];
}

export async function hasOauthCredential(db: DbLike, mailboxId: number): Promise<boolean> {
  const rows = await db
    .select({ mailboxId: mailboxOauthCredentials.mailboxId })
    .from(mailboxOauthCredentials)
    .where(eq(mailboxOauthCredentials.mailboxId, mailboxId));
  return rows.length === 1;
}

export async function getOauthCredential(
  db: DbLike,
  mailboxId: number,
): Promise<OauthCredentialRow | null> {
  const rows = await db
    .select({
      sealedRefreshToken: mailboxOauthCredentials.sealedRefreshToken,
      grantedEmail: mailboxOauthCredentials.grantedEmail,
      scopes: mailboxOauthCredentials.scopes,
    })
    .from(mailboxOauthCredentials)
    .where(eq(mailboxOauthCredentials.mailboxId, mailboxId));
  return rows[0] ?? null;
}

export async function upsertOauthCredential(
  db: DbLike,
  input: {
    mailboxId: number;
    sealedRefreshToken: Buffer;
    grantedEmail: string;
    scopes: string[];
    at: Date;
  },
): Promise<void> {
  await db
    .insert(mailboxOauthCredentials)
    .values({
      mailboxId: input.mailboxId,
      sealedRefreshToken: input.sealedRefreshToken,
      grantedEmail: input.grantedEmail,
      scopes: input.scopes,
      updatedAt: input.at,
    })
    .onConflictDoUpdate({
      target: mailboxOauthCredentials.mailboxId,
      set: {
        sealedRefreshToken: input.sealedRefreshToken,
        grantedEmail: input.grantedEmail,
        scopes: input.scopes,
        updatedAt: input.at,
      },
    });
}

export async function deleteOauthCredential(db: DbLike, mailboxId: number): Promise<void> {
  await db.delete(mailboxOauthCredentials).where(eq(mailboxOauthCredentials.mailboxId, mailboxId));
}

export async function insertOauthState(
  db: DbLike,
  input: {
    stateHash: string;
    mailboxId: number;
    sealedCodeVerifier: Buffer;
    expiresAt: Date;
  },
): Promise<void> {
  await db.insert(mailboxOauthStates).values(input);
}

/** Atomically marks a live state as used. A replay or expired state returns null. */
export async function consumeOauthState(
  db: Db,
  stateHash: string,
  now: Date,
): Promise<{ mailboxId: number; sealedCodeVerifier: Buffer } | null> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .update(mailboxOauthStates)
      .set({ usedAt: now })
      .where(
        and(
          eq(mailboxOauthStates.stateHash, stateHash),
          isNull(mailboxOauthStates.usedAt),
          gt(mailboxOauthStates.expiresAt, now),
        ),
      )
      .returning({
        mailboxId: mailboxOauthStates.mailboxId,
        sealedCodeVerifier: mailboxOauthStates.sealedCodeVerifier,
      });
    return rows[0] ?? null;
  });
}

export async function listOauthSecrets(
  db: DbLike,
): Promise<
  Array<
    | { kind: 'refresh'; mailboxId: number; sealed: Buffer }
    | { kind: 'pkce'; stateHash: string; sealed: Buffer }
  >
> {
  const [credentials, states] = await Promise.all([
    db
      .select({
        mailboxId: mailboxOauthCredentials.mailboxId,
        sealed: mailboxOauthCredentials.sealedRefreshToken,
      })
      .from(mailboxOauthCredentials),
    db
      .select({
        stateHash: mailboxOauthStates.stateHash,
        sealed: mailboxOauthStates.sealedCodeVerifier,
      })
      .from(mailboxOauthStates),
  ]);
  return [
    ...credentials.map((row) => ({ kind: 'refresh' as const, ...row })),
    ...states.map((row) => ({ kind: 'pkce' as const, ...row })),
  ];
}

export async function replaceOauthSecret(
  db: DbLike,
  secret:
    | { kind: 'refresh'; mailboxId: number; sealed: Buffer; at: Date }
    | { kind: 'pkce'; stateHash: string; sealed: Buffer },
): Promise<void> {
  if (secret.kind === 'refresh') {
    await db
      .update(mailboxOauthCredentials)
      .set({ sealedRefreshToken: secret.sealed, updatedAt: secret.at })
      .where(eq(mailboxOauthCredentials.mailboxId, secret.mailboxId));
    return;
  }
  await db
    .update(mailboxOauthStates)
    .set({ sealedCodeVerifier: secret.sealed })
    .where(eq(mailboxOauthStates.stateHash, secret.stateHash));
}
