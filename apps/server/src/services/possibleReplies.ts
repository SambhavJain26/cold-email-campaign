import type { Db, DbLike } from '../db/client';
import type { ReviewQueueItem } from '@coldemail/shared';
import {
  listRows,
  readMessage,
  activity,
  updateMessage,
  lockMessage,
  operationExists,
} from '../db/repos/incomingReviewRepo';
import {
  findReplyCandidates,
  storedReplyCandidates,
  possibleMessageIds,
  candidateScanMessages,
  saveReplyCandidates,
  mailboxFreshness,
} from '../db/repos/replyCandidatesRepo';
import { acquireRebuildLockShared } from '../db/repos/locksRepo';
import { IncomingReviewError } from './incomingReviewActions';

export type QueueOptions = Parameters<typeof listRows>[1];
export async function possibleDetail(db: DbLike, id: number) {
  const message = await readMessage(db, id);
  if (!message) throw new IncomingReviewError('not_found', 'Incoming message not found');
  return { message, candidates: await storedReplyCandidates(db, id) };
}
export async function reviewQueue(db: DbLike, opts: QueueOptions) {
  // Only this prefix can contribute to the merged page. Do not load the full
  // confirmed inbox just to interleave a few possible messages.
  const leads = await listRows(db, { ...opts, page: 1, per_page: opts.page * opts.per_page });
  const items: ReviewQueueItem[] = leads.items.map((row) => ({ kind: 'lead', row }));
  const query = opts.search?.trim().toLowerCase();
  for (const { id } of await possibleMessageIds(db, opts)) {
    const message = await readMessage(db, id, undefined, undefined, false);
    if (
      !message ||
      (opts.view === 'needs_review' && message.acknowledged) ||
      (opts.view === 'acknowledged' && !message.acknowledged)
    )
      continue;
    const candidates = (await storedReplyCandidates(db, id)).filter(
      (c) => !opts.campaign_id || c.campaign_id === opts.campaign_id,
    );
    if (!candidates.length) continue;
    if (
      query &&
      ![
        message.from_address,
        message.subject,
        ...candidates.flatMap((c) => [c.name, c.email, c.company, c.campaign_name]),
      ].some((s) => s?.toLowerCase().includes(query))
    )
      continue;
    items.push({ kind: 'possible', item: { message, candidates } });
  }
  const time = (item: ReviewQueueItem) =>
    item.kind === 'lead' ? item.row.latest_received_at : item.item.message.received_at;
  const key = (item: ReviewQueueItem) =>
    item.kind === 'lead'
      ? `l:${item.row.lead_id}:${item.row.campaign_id}`
      : `p:${item.item.message.id}`;
  items.sort(
    (a, b) => (time(b) ?? '').localeCompare(time(a) ?? '') || key(a).localeCompare(key(b)),
  );
  const possibleCount = items.length - leads.items.length;
  return {
    items: items.slice((opts.page - 1) * opts.per_page, opts.page * opts.per_page),
    total: leads.total + possibleCount,
    lead_count: leads.total,
    possible_count: possibleCount,
  };
}
export async function reviewSummary(db: DbLike, opts: QueueOptions, now: Date) {
  const q = await reviewQueue(db, opts);
  return {
    lead_count: q.lead_count,
    possible_count: q.possible_count,
    mailboxes: await mailboxFreshness(db, now),
  };
}
export async function candidateVisibility(
  db: Db,
  id: number,
  body: { operation_id: string; expected_revision: number; action: 'dismiss' | 'return' },
  now: Date,
) {
  await db.transaction(async (tx) => {
    await acquireRebuildLockShared(tx);
    if (await operationExists(tx, body.operation_id)) return;
    await lockMessage(tx, id);
    if (await operationExists(tx, body.operation_id)) return;
    const m = await readMessage(tx, id);
    if (!m) throw new IncomingReviewError('not_found', 'Incoming message not found');
    if (
      m.revision !== body.expected_revision ||
      m.links.length ||
      !['needs_linking', 'unrelated'].includes(m.linking_status)
    )
      throw new IncomingReviewError('conflict', 'The message changed. Refresh before deciding.');
    if (!(await storedReplyCandidates(tx, id)).length)
      throw new IncomingReviewError('validation', 'This message has no possible outreach match.');
    await updateMessage(tx, id, null, body.action === 'dismiss' ? 'unrelated' : 'needs_linking');
    await activity(
      tx,
      id,
      body.operation_id,
      body.action === 'dismiss' ? 'acknowledged' : 'returned',
      now,
      { possible_reply: true },
    );
  });
}
/** Explicit metadata-only operation. No mailbox access, classification or outreach replay. */
export async function scanPossibleReplies(db: Db, now: Date, apply = false, ids?: number[]) {
  const result: { message_id: number; enrollment_ids: number[] }[] = [];
  for (const m of await candidateScanMessages(db, now, ids)) {
    const candidates = await findReplyCandidates(db, {
      mailboxId: m.mailbox_id,
      from: m.from_address,
      subject: m.subject,
      receivedAt: new Date(m.received_at),
    });
    if (candidates.length) {
      result.push({ message_id: m.id, enrollment_ids: candidates.map((c) => c.enrollment_id) });
      if (apply)
        await db.transaction(async (tx) => {
          await acquireRebuildLockShared(tx);
          await lockMessage(tx, m.id);
          const current = await readMessage(tx, m.id);
          if (current?.linking_status === 'needs_linking')
            await saveReplyCandidates(tx, m.id, candidates);
        });
    }
  }
  return result;
}
