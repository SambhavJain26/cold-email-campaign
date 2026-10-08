import { mkdir, open, readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { Db } from '../db/client';
import type { MailTransport } from '../transport/types';
import { extractNewText } from '../poller/reviewText';
import { getSettings } from '../db/repos/settingsRepo';
import { acquireRebuildLockShared, lockLead } from '../db/repos/locksRepo';
import {
  readMessage,
  lockMessage,
  activity,
  operationExists,
  deleteMessageContent,
  retentionCandidates,
  replayContentDeletion,
  incomingMessageIdentity,
  replaceRecoveredContent,
} from '../db/repos/incomingReviewRepo';
import { IncomingReviewError } from './incomingReviewActions';

const manifestEntry = z
  .object({
    epoch: z.string().uuid(),
    id: z.number().int().positive(),
    message_id: z.string().nullable(),
    deleted_at: z.iso.datetime(),
    operation_id: z.string(),
  })
  .strict();
/** Durable write-ahead deletion intent. fsync before committing a tombstone; never store message text. */
async function writeManifest(file: string, entry: z.infer<typeof manifestEntry>): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const handle = await open(file, 'a', 0o600);
  try {
    await handle.writeFile(JSON.stringify(entry) + '\n');
    await handle.sync();
  } finally {
    await handle.close();
  }
}
export async function deleteStoredContent(
  db: Db,
  id: number,
  body: { operation_id: string; expected_revision: number },
  now: Date,
  manifestPath: string,
  retention = false,
): Promise<void> {
  await db.transaction(async (tx) => {
    await acquireRebuildLockShared(tx);
    if (await operationExists(tx, body.operation_id)) return;
    const before = await readMessage(tx, id);
    if (!before) throw new IncomingReviewError('not_found', 'Incoming message not found');
    for (const leadId of [...new Set(before.links.map((l) => l.lead_id))].sort((a, b) => a - b))
      await lockLead(tx, leadId);
    await lockMessage(tx, id);
    if (await operationExists(tx, body.operation_id)) return;
    const message = await readMessage(tx, id);
    if (!message) throw new IncomingReviewError('not_found', 'Incoming message not found');
    if (message.revision !== body.expected_revision)
      throw new IncomingReviewError(
        'conflict',
        'The message changed. Refresh before deleting stored content.',
      );
    if (message.capture_status === 'deleted') return;
    if (retention && !(await retentionCandidates(tx, now)).includes(id)) return;
    const settings = await getSettings(tx);
    const identity = await incomingMessageIdentity(tx, id);
    await writeManifest(manifestPath, {
      epoch: settings.incomingIdentityEpoch,
      id,
      message_id: identity!.messageId,
      deleted_at: now.toISOString(),
      operation_id: body.operation_id,
    });
    await deleteMessageContent(tx, id, now);
    await activity(
      tx,
      id,
      body.operation_id,
      retention ? 'retention_deleted' : 'content_deleted',
      now,
    );
  });
}
export async function cleanAcknowledgedContent(
  db: Db,
  now: Date,
  manifestPath: string,
): Promise<number> {
  let removed = 0;
  for (const id of await retentionCandidates(db, now)) {
    const m = await readMessage(db, id);
    if (!m) continue;
    await deleteStoredContent(
      db,
      id,
      { operation_id: `retention:${id}:${m.revision}`, expected_revision: m.revision },
      now,
      manifestPath,
      true,
    );
    if ((await readMessage(db, id))?.capture_status === 'deleted') removed++;
  }
  return removed;
}
/** Startup / restore gate. Corrupt manifests fail closed before API and workers start. */
export async function reapplyDeletionManifest(
  db: Db,
  file: string,
  requireExisting = false,
): Promise<number> {
  let contents: string;
  try {
    contents = await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' && !requireExisting) {
      await mkdir(path.dirname(file), { recursive: true });
      const handle = await open(file, 'a', 0o600);
      await handle.close();
      return 0;
    }
    throw error;
  }
  const entries = contents
    .split('\n')
    .filter(Boolean)
    .map((line) => manifestEntry.parse(JSON.parse(line)));
  await db.transaction(async (tx) => {
    await acquireRebuildLockShared(tx);
    for (const entry of entries)
      await replayContentDeletion(
        tx,
        entry.epoch,
        entry.id,
        entry.message_id,
        new Date(entry.deleted_at),
      );
  });
  return entries.length;
}

/** Fetch outside the transaction, then recheck revision/tombstone before accepting content only. */
export async function recoverStoredContent(
  db: Db,
  transport: MailTransport,
  id: number,
  body: { operation_id: string; expected_revision: number },
  now: Date,
): Promise<void> {
  if (await operationExists(db, body.operation_id)) return;
  const before = await readMessage(db, id);
  const identity = await incomingMessageIdentity(db, id);
  if (!before || !identity)
    throw new IncomingReviewError('not_found', 'Incoming message not found');
  if (before.capture_status === 'deleted')
    throw new IncomingReviewError('conflict', 'Intentionally deleted content cannot be recovered.');
  if (before.revision !== body.expected_revision)
    throw new IncomingReviewError('conflict', 'Refresh the message before recovering content.');
  if (!identity.messageId || !transport.recoverIncoming)
    throw new IncomingReviewError(
      'validation',
      'Content recovery requires a stored Message-ID and a connected IMAP transport.',
    );
  let recovered;
  try {
    recovered = await transport.recoverIncoming({
      mailboxId: identity.mailboxId,
      messageId: identity.messageId,
      from: identity.from,
      subject: identity.subject,
      receivedAt: identity.receivedAt,
    });
  } catch (error) {
    throw new IncomingReviewError(
      'validation',
      error instanceof Error ? error.message : 'Content recovery failed.',
    );
  }
  if (recovered.contentStatus !== 'captured')
    throw new IncomingReviewError(
      'validation',
      'Full content is unavailable or exceeds the 5 MiB limit.',
    );
  const extracted = extractNewText(recovered.bodyText);
  await db.transaction(async (tx) => {
    await acquireRebuildLockShared(tx);
    for (const leadId of [...new Set(before.links.map((l) => l.lead_id))].sort((a, b) => a - b))
      await lockLead(tx, leadId);
    await lockMessage(tx, id);
    if (await operationExists(tx, body.operation_id)) return;
    const current = await readMessage(tx, id);
    if (
      !current ||
      current.capture_status === 'deleted' ||
      current.revision !== body.expected_revision
    )
      throw new IncomingReviewError(
        'conflict',
        'The message changed during recovery. Content was not restored.',
      );
    await replaceRecoveredContent(tx, id, recovered, extracted.newText, extracted.quotedText);
    await activity(tx, id, body.operation_id, 'content_recovered', now);
  });
}
