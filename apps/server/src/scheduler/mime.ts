// buildMime (docs/08 §6, docs/07 §4): the app-generated Message-ID and the
// In-Reply-To/References chain for in-thread steps. Shared by the scheduler's
// sendOne and the manual-compose service - the ONE place threading headers
// are built.
import type { DbLike } from '../db/client';
import { listThreadMessageIds } from '../db/repos/sentMessagesRepo';

/** `<ce-{enrollment}-{step}-{epochMs}@{mailbox-domain}>` - known before send (docs/07 §4). */
export function buildMessageId(
  enrollmentId: number,
  stepNo: number,
  now: Date,
  fromAddress: string,
): string {
  return `<ce-${enrollmentId}-${stepNo}-${now.getTime()}@${fromAddress.split('@')[1]}>`;
}

export interface ThreadHeaders {
  inReplyTo?: string;
  references?: string[];
}

/**
 * In-Reply-To = previous step's Message-ID; References = all prior ids in
 * order. Same-step soft-retries re-anchor to the PREVIOUS step, not the
 * bounced attempt (the stepNo < current filter).
 */
export async function buildThreadHeaders(
  db: DbLike,
  enrollmentId: number,
  stepNo: number,
  inThread: boolean,
): Promise<ThreadHeaders> {
  if (!inThread) return {};
  const thread = (await listThreadMessageIds(db, enrollmentId)).filter((m) => m.stepNo < stepNo);
  if (thread.length === 0) return {};
  return {
    inReplyTo: thread.at(-1)!.messageId,
    references: thread.map((m) => m.messageId),
  };
}
