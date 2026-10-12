import { createHash } from 'node:crypto';
import {
  isTerminal,
  type ScheduleProposal,
  type SchedulePreview,
  type ScheduleApplyBody,
} from '@coldemail/shared';
import type { Db } from '../db/client';
import {
  scheduleSnapshot,
  lockScheduleChange,
  writeSchedulePolicy,
  scheduleReceipt,
  saveScheduleReceipt,
} from '../db/repos/sequenceScheduleRepo';
import { findSentByMessageIds } from '../db/repos/sentMessagesRepo';
import { followupDueAt } from '../scheduler/followupDue';
import { resolveTimezone } from '../scheduler/tzmap';
import { buildEvent } from '../domain/events';
import type { EventStore } from './eventStore';
import { AppError } from '../api/errors';

type Snapshot = NonNullable<Awaited<ReturnType<typeof scheduleSnapshot>>>;
const hash = (value: unknown) =>
  createHash('sha256')
    .update(
      JSON.stringify(value, (_key, item: unknown) =>
        item !== null && typeof item === 'object' && !Array.isArray(item)
          ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
          : item,
      ),
    )
    .digest('hex');
const iso = (date: Date | null) => date?.toISOString() ?? null;
function previewOf(snapshot: Snapshot, proposal: ScheduleProposal): SchedulePreview {
  const blockers: string[] = [];
  const expected = snapshot.sequence.steps.map((s) => s.step.stepNo);
  const actual = proposal.steps.map((s) => s.step_no).sort((a, b) => a - b);
  if (
    JSON.stringify(expected) !== JSON.stringify(actual) ||
    proposal.steps.find((s) => s.step_no === 1)?.wait_days !== 0
  )
    blockers.push(
      'Timing must include every existing step exactly once, with zero wait for Email 1.',
    );
  const history = new Map(snapshot.history);
  const rows = snapshot.rows.map(({ enrollment: e, lead, mailbox }) => {
    const row: SchedulePreview['rows'][number] = {
      enrollment_id: e.id,
      lead_id: lead.id,
      lead_name: [lead.firstName, lead.lastName].filter(Boolean).join(' ') || lead.email,
      lead_email: lead.email,
      campaign_id: e.campaignId,
      step_no: e.currentStepNo,
      old_due_at: iso(e.nextSendAt),
      new_due_at: null,
      effective_due_at: null,
      timezone: null,
      source_send_id: null,
      held: e.reviewHoldIds.length > 0,
      exclusion: null,
      error: null,
    };
    if (isTerminal(e.currentState)) {
      row.exclusion = 'Terminal or completed enrollment';
      return row;
    }
    const facts = history.get(e.id) ?? [];
    const sent = facts.filter((f) => f.type === 'sent').at(-1);
    if (
      sent?.type === 'sent' &&
      facts.some(
        (f) =>
          f.type === 'soft_bounce' && f.stepNo === sent.stepNo && f.occurredAt >= sent.occurredAt,
      )
    ) {
      row.exclusion = 'Pending soft-bounce retry';
      return row;
    }
    if (e.currentStepNo === 1 && !sent) {
      row.exclusion = 'Unsent first email';
      return row;
    }
    const step = proposal.steps.find((s) => s.step_no === e.currentStepNo);
    if (
      !step &&
      e.currentStepNo > expected.length &&
      sent?.type === 'sent' &&
      sent.stepNo === expected.at(-1)
    ) {
      row.exclusion = 'All sequence emails accepted';
      return row;
    }
    if (lead.isErased || lead.isSuppressed || snapshot.suppressed.includes(lead.email)) {
      row.exclusion = 'Erased or suppressed lead';
      return row;
    }
    if (
      !step ||
      sent?.type !== 'sent' ||
      sent.stepNo !== e.currentStepNo - 1 ||
      !e.nextSendAt ||
      !mailbox ||
      sent.mailboxId !== mailbox.id
    ) {
      row.error = 'The previous sent email or its sending mailbox could not be verified';
      return row;
    }
    row.timezone = resolveTimezone(
      lead.state,
      mailbox.timezone || snapshot.settings.defaultTimezone,
    );
    row.source_send_id = sent.id!;
    const due = followupDueAt(
      sent.occurredAt,
      step.wait_days,
      proposal.wait_day_mode,
      row.timezone,
    );
    row.new_due_at = iso(due);
    row.effective_due_at = new Date(
      Math.max(due.getTime(), e.delayedUntil?.getTime() ?? 0, e.snoozedUntil?.getTime() ?? 0),
    ).toISOString();
    return row;
  });
  for (const c of snapshot.campaigns) {
    if (
      c.status === 'active' ||
      (snapshot.rows.some(
        (r) => r.enrollment.campaignId === c.id && !isTerminal(r.enrollment.currentState),
      ) &&
        c.status !== 'paused')
    )
      blockers.push(`Pause campaign ${c.id} (${c.name}) before applying the schedule.`);
  }
  if (rows.some((r) => r.error)) blockers.push('Verify the previous sent emails before applying.');
  // Poll freshness is unrelated to schedule decisions and must not stale a preview.
  const fingerprintSnapshot = {
    ...snapshot,
    rows: snapshot.rows.map((r) => ({
      enrollment: r.enrollment,
      lead: {
        id: r.lead.id,
        state: r.lead.state,
        isErased: r.lead.isErased,
        isSuppressed: r.lead.isSuppressed,
      },
      mailbox: r.mailbox
        ? {
            id: r.mailbox.id,
            timezone: r.mailbox.timezone,
            status: r.mailbox.status,
            dailyCap: r.mailbox.dailyCap,
            sendWindow: r.mailbox.sendWindow,
          }
        : null,
    })),
  };
  return {
    fingerprint: hash({ snapshot: fingerprintSnapshot, proposal }),
    campaigns: snapshot.campaigns.map((c) => ({ id: c.id, name: c.name, status: c.status })),
    rows,
    blockers,
    can_apply: blockers.length === 0,
  };
}

export async function previewScheduleChange(
  db: Db,
  sequenceId: number,
  proposal: ScheduleProposal,
) {
  return db.transaction(
    async (tx) => {
      const snapshot = await scheduleSnapshot(tx, sequenceId);
      if (!snapshot) throw AppError.notFound('sequence');
      const preview = previewOf(snapshot, proposal);
      // Verify immutable accepted-message identity as well as ledger step progression.
      for (const row of preview.rows.filter((r) => r.source_send_id !== null)) {
        const source = new Map(snapshot.history)
          .get(row.enrollment_id)!
          .find((f) => f.id === row.source_send_id)!;
        const saved =
          source.type === 'sent'
            ? (await findSentByMessageIds(tx, [source.messageId])).get(source.messageId)
            : null;
        if (
          !saved ||
          source.type !== 'sent' ||
          saved.enrollmentId !== row.enrollment_id ||
          saved.leadId !== source.leadId ||
          saved.stepNo !== source.stepNo ||
          saved.mailboxId !== source.mailboxId ||
          saved.contentHash !== source.attributes.content_hash ||
          saved.sentAt.getTime() !== source.occurredAt.getTime()
        ) {
          row.error = 'The preceding accepted message could not be verified';
          preview.can_apply = false;
          preview.blockers.push(`Accepted message missing for enrollment ${row.enrollment_id}.`);
        }
      }
      return preview;
    },
    { isolationLevel: 'repeatable read' },
  );
}

export async function applyScheduleChange(
  db: Db,
  store: EventStore,
  sequenceId: number,
  body: ScheduleApplyBody,
  now: Date,
) {
  const proposal: ScheduleProposal = { wait_day_mode: body.wait_day_mode, steps: body.steps };
  return db.transaction(async (tx) => {
    await lockScheduleChange(tx, sequenceId);
    const prior = await scheduleReceipt(tx, body.operation_id);
    if (prior) {
      if (
        Number(prior.sequence_id) !== sequenceId ||
        prior.fingerprint !== body.fingerprint ||
        hash(prior.result.proposal) !== hash(proposal)
      )
        throw new AppError('conflict', 409, 'Operation ID belongs to another schedule change.');
      return { changed: prior.result.changed };
    }
    const snapshot = await scheduleSnapshot(tx, sequenceId);
    if (!snapshot) throw AppError.notFound('sequence');
    const preview = previewOf(snapshot, proposal);
    if (preview.fingerprint !== body.fingerprint)
      throw new AppError(
        'conflict',
        409,
        'Scheduling information changed. Preview again before applying.',
      );
    if (!preview.can_apply) throw new AppError('conflict', 409, preview.blockers.join(' '));
    for (const row of preview.rows.filter((r) => r.source_send_id !== null)) {
      const source = new Map(snapshot.history)
        .get(row.enrollment_id)!
        .find((f) => f.id === row.source_send_id)!;
      const saved =
        source.type === 'sent'
          ? (await findSentByMessageIds(tx, [source.messageId])).get(source.messageId)
          : null;
      if (
        !saved ||
        source.type !== 'sent' ||
        saved.enrollmentId !== row.enrollment_id ||
        saved.leadId !== source.leadId ||
        saved.stepNo !== source.stepNo ||
        saved.mailboxId !== source.mailboxId ||
        saved.contentHash !== source.attributes.content_hash ||
        saved.sentAt.getTime() !== source.occurredAt.getTime()
      )
        throw new AppError(
          'conflict',
          409,
          'The preceding accepted message could not be verified.',
        );
    }
    await writeSchedulePolicy(tx, sequenceId, proposal);
    const changed = preview.rows.filter(
      (r) => !r.error && !r.exclusion && r.old_due_at !== r.new_due_at,
    );
    const facts = changed.map((row) =>
      buildEvent.scheduleRecalculated({
        leadId: snapshot.rows.find((r) => r.enrollment.id === row.enrollment_id)!.lead.id,
        enrollmentId: row.enrollment_id,
        campaignId: row.campaign_id,
        occurredAt: now,
        attributes: {
          old_due_at: row.old_due_at!,
          new_due_at: row.new_due_at!,
          source_send_id: row.source_send_id!,
          timezone: row.timezone!,
          wait_day_mode: proposal.wait_day_mode,
          wait_days: proposal.steps.find((s) => s.step_no === row.step_no)!.wait_days,
          operation_id: body.operation_id,
        },
      }),
    );
    await store.appendInTransaction(tx, facts, {
      patches: changed.map((r) => ({
        enrollmentId: r.enrollment_id,
        nextSendAt: new Date(r.new_due_at!),
      })),
    });
    await saveScheduleReceipt(
      tx,
      sequenceId,
      body.operation_id,
      body.fingerprint,
      { changed: changed.length, proposal },
      now,
    );
    return { changed: changed.length };
  });
}
