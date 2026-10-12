import { asc, eq, inArray, sql } from 'drizzle-orm';
import type { DbLike } from '../client';
import { campaigns, enrollments, leads, mailboxes, sequences, sequenceSteps } from '../schema';
import { getSequenceNested } from './sequencesRepo';
import { getSettings } from './settingsRepo';
import { listByEnrollments } from './eventsRepo';
import { suppressedAmong } from './suppressionsRepo';
import { acquireRebuildLockShared, lockLead, lockEnrollment } from './locksRepo';
import type { ScheduleProposal } from '@coldemail/shared';

export async function scheduleSnapshot(db: DbLike, sequenceId: number) {
  const sequence = await getSequenceNested(db, sequenceId);
  if (!sequence) return null;
  const refs = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.sequenceId, sequenceId))
    .orderBy(asc(campaigns.id));
  const rows = refs.length
    ? await db
        .select({ enrollment: enrollments, lead: leads, mailbox: mailboxes })
        .from(enrollments)
        .innerJoin(leads, eq(leads.id, enrollments.leadId))
        .leftJoin(mailboxes, eq(mailboxes.id, enrollments.assignedMailboxId))
        .where(
          inArray(
            enrollments.campaignId,
            refs.map((c) => c.id),
          ),
        )
        .orderBy(asc(enrollments.id))
    : [];
  const history = await listByEnrollments(
    db,
    rows.map((r) => r.enrollment.id),
  );
  const suppressed = await suppressedAmong(
    db,
    rows.map((r) => r.lead.email),
  );
  return {
    sequence,
    campaigns: refs,
    rows,
    history: [...history.entries()],
    suppressed: [...suppressed].sort(),
    settings: await getSettings(db),
  };
}

/** Sequence then sorted campaign/identity locks; no SMTP or other external work. */
export async function lockScheduleChange(db: DbLike, sequenceId: number) {
  await acquireRebuildLockShared(db);
  await db.execute(sql`SELECT id FROM sequences WHERE id=${sequenceId} FOR UPDATE`);
  await db.execute(
    sql`SELECT id FROM campaigns WHERE sequence_id=${sequenceId} ORDER BY id FOR UPDATE`,
  );
  const snapshot = await scheduleSnapshot(db, sequenceId);
  if (!snapshot) return;
  for (const id of [...new Set(snapshot.rows.map((r) => r.lead.id))].sort((a, b) => a - b))
    await lockLead(db, id);
  for (const r of snapshot.rows) await lockEnrollment(db, r.enrollment.id);
  const mailboxIds = snapshot.rows.flatMap((r) => (r.mailbox ? [r.mailbox.id] : []));
  if (mailboxIds.length)
    await db.execute(
      sql`SELECT id FROM mailboxes WHERE id IN (${sql.join(
        [...new Set(mailboxIds)].sort((a, b) => a - b).map((id) => sql`${id}`),
        sql`,`,
      )}) ORDER BY id FOR UPDATE`,
    );
}

export async function writeSchedulePolicy(
  db: DbLike,
  sequenceId: number,
  proposal: ScheduleProposal,
) {
  await db
    .update(sequences)
    .set({ waitDayMode: proposal.wait_day_mode })
    .where(eq(sequences.id, sequenceId));
  for (const step of proposal.steps)
    await db
      .update(sequenceSteps)
      .set({ waitDays: step.wait_days, inThread: step.in_thread })
      .where(
        sql`${sequenceSteps.sequenceId}=${sequenceId} AND ${sequenceSteps.stepNo}=${step.step_no}`,
      );
}
export async function scheduleReceipt(db: DbLike, operationId: string) {
  const result = await db.execute(
    sql`SELECT sequence_id, fingerprint, result FROM sequence_schedule_operations WHERE operation_id=${operationId}`,
  );
  return result.rows[0] as
    | {
        sequence_id: number;
        fingerprint: string;
        result: { changed: number; proposal: ScheduleProposal };
      }
    | undefined;
}
export async function saveScheduleReceipt(
  db: DbLike,
  sequenceId: number,
  operationId: string,
  fingerprint: string,
  result: { changed: number; proposal: ScheduleProposal },
  now: Date,
) {
  await db.execute(sql`INSERT INTO sequence_schedule_operations(operation_id,sequence_id,fingerprint,result,occurred_at)
    VALUES(${operationId},${sequenceId},${fingerprint},${JSON.stringify(result)}::jsonb,${now})`);
}
