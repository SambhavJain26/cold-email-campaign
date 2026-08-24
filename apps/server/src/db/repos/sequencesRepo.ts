import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { Db, DbLike } from '../client';
import { campaigns, sequences, sequenceSteps, stepVariants } from '../schema';
import type { SequenceDef } from '../../domain/sequence';

export type SequenceRow = typeof sequences.$inferSelect;
export type StepVariantRow = typeof stepVariants.$inferSelect;

/** The sequence a campaign sends, or null if none assigned. */
export async function sequenceIdForCampaign(
  db: DbLike,
  campaignId: number,
): Promise<number | null> {
  const rows = await db
    .select({ sequenceId: campaigns.sequenceId })
    .from(campaigns)
    .where(eq(campaigns.id, campaignId));
  return rows[0]?.sequenceId ?? null;
}

/**
 * Assemble the scheduler's SequenceDef from the 0003 tables: steps ordered by
 * step_no, ACTIVE variants only (docs/03 §3), ordered by label so round-robin
 * (B4.8) walks A,B,… deterministically. Returns null if the sequence row
 * doesn't exist.
 */
export async function loadSequenceDef(db: DbLike, sequenceId: number): Promise<SequenceDef | null> {
  const seqRows = await db
    .select({ id: sequences.id, stopOnReply: sequences.stopOnReply })
    .from(sequences)
    .where(eq(sequences.id, sequenceId));
  if (seqRows.length === 0) return null;

  const steps = await db
    .select()
    .from(sequenceSteps)
    .where(eq(sequenceSteps.sequenceId, sequenceId))
    .orderBy(asc(sequenceSteps.stepNo));

  const variants =
    steps.length === 0
      ? []
      : await db
          .select()
          .from(stepVariants)
          .where(
            inArray(
              stepVariants.stepId,
              steps.map((s) => s.id),
            ),
          )
          .orderBy(asc(stepVariants.label));

  return {
    id: sequenceId,
    stopOnReply: seqRows[0]!.stopOnReply,
    steps: steps.map((s) => ({
      stepNo: s.stepNo,
      waitDays: s.waitDays,
      inThread: s.inThread,
      variants: variants
        .filter((v) => v.stepId === s.id && v.active)
        .map((v) => ({
          id: v.id,
          label: v.label,
          contentHash: v.contentHash,
          subjectTemplate: v.subjectTemplate,
          bodyTemplate: v.bodyTemplate,
        })),
    })),
  };
}

/** The sequence_steps row id for (sequence, step_no) — bespoke variants attach here. */
export async function getStepId(
  db: DbLike,
  sequenceId: number,
  stepNo: number,
): Promise<number | null> {
  const rows = await db
    .select({ id: sequenceSteps.id })
    .from(sequenceSteps)
    .where(and(eq(sequenceSteps.sequenceId, sequenceId), eq(sequenceSteps.stepNo, stepNo)));
  return rows[0]?.id ?? null;
}

/** Full variant row by id — ignores `active` (bespoke/rotated-out lookups). */
export async function getVariantById(
  db: DbLike,
  variantId: number,
): Promise<StepVariantRow | undefined> {
  const rows = await db.select().from(stepVariants).where(eq(stepVariants.id, variantId));
  return rows[0];
}

export interface CreateSequenceInput {
  name: string;
  variableDefaults?: Record<string, string>;
  stopOnReply?: boolean;
  stopOnHardBounce?: boolean;
  stopOnUnsubscribe?: boolean;
  steps: Array<{
    stepNo: number;
    waitDays: number;
    inThread: boolean;
    variants: Array<{
      label: string;
      subjectTemplate: string;
      bodyTemplate: string;
      /** Computed by the caller via render/hash (decision Q). */
      contentHash: string;
      active?: boolean;
    }>;
  }>;
}

/** Insert a whole sequence tree; returns the new sequence id. (Tests + B6.5.) */
export async function createSequence(db: DbLike, input: CreateSequenceInput): Promise<number> {
  const [seq] = await db
    .insert(sequences)
    .values({
      name: input.name,
      variableDefaults: input.variableDefaults ?? {},
      ...(input.stopOnReply !== undefined && { stopOnReply: input.stopOnReply }),
      // These columns remain for backwards-compatible storage only. Runtime
      // behaviour is intentionally mandatory for bounces and STOP requests.
      stopOnHardBounce: true,
      stopOnUnsubscribe: true,
    })
    .returning({
      id: sequences.id,
    });
  const sequenceId = seq!.id;
  for (const step of input.steps) {
    const [stepRow] = await db
      .insert(sequenceSteps)
      .values({
        sequenceId,
        stepNo: step.stepNo,
        waitDays: step.waitDays,
        inThread: step.inThread,
      })
      .returning({ id: sequenceSteps.id });
    for (const v of step.variants) {
      await db.insert(stepVariants).values({
        stepId: stepRow!.id,
        label: v.label,
        subjectTemplate: v.subjectTemplate,
        bodyTemplate: v.bodyTemplate,
        contentHash: v.contentHash,
        active: v.active ?? true,
      });
    }
  }
  return sequenceId;
}

// ── B6.5 nested read/write ───────────────────────────────────────────────────

export interface NestedSequence {
  sequence: SequenceRow;
  steps: Array<{
    step: typeof sequenceSteps.$inferSelect;
    /** Builder view: bespoke (Mode-1) variants are excluded — they're send
     *  artifacts, not editable copy. Retired (active=false) variants stay. */
    variants: StepVariantRow[];
  }>;
}

export async function getSequenceNested(
  db: DbLike,
  sequenceId: number,
): Promise<NestedSequence | null> {
  const seqRows = await db.select().from(sequences).where(eq(sequences.id, sequenceId));
  const sequence = seqRows[0];
  if (!sequence) return null;
  const steps = await db
    .select()
    .from(sequenceSteps)
    .where(eq(sequenceSteps.sequenceId, sequenceId))
    .orderBy(asc(sequenceSteps.stepNo));
  const variants =
    steps.length === 0
      ? []
      : await db
          .select()
          .from(stepVariants)
          .where(
            inArray(
              stepVariants.stepId,
              steps.map((s) => s.id),
            ),
          )
          .orderBy(asc(stepVariants.label));
  return {
    sequence,
    steps: steps.map((step) => ({
      step,
      variants: variants.filter((v) => v.stepId === step.id && v.attributes.bespoke !== true),
    })),
  };
}

export async function listSequencesNested(db: DbLike): Promise<NestedSequence[]> {
  const seqRows = await db
    .select()
    .from(sequences)
    .where(eq(sequences.archived, false))
    .orderBy(asc(sequences.id));
  const out: NestedSequence[] = [];
  for (const s of seqRows) {
    out.push((await getSequenceNested(db, s.id))!);
  }
  return out;
}

/** Any real send through this sequence? Gates the edit policy below. */
export async function sequenceHasSends(db: DbLike, sequenceId: number): Promise<boolean> {
  const rows = await db.execute(sql`
    SELECT 1 FROM sent_messages sm
    JOIN enrollments e ON e.id = sm.enrollment_id
    JOIN campaigns c ON c.id = e.campaign_id
    WHERE c.sequence_id = ${sequenceId}
    LIMIT 1`);
  return rows.rows.length > 0;
}

export async function deleteSequenceIfUnreferenced(
  db: DbLike,
  sequenceId: number,
): Promise<{ deleted: boolean; reason?: string }> {
  const refs = await db.execute(sql`
    SELECT
      (SELECT count(*)::int FROM campaigns WHERE sequence_id = ${sequenceId}) AS campaigns,
      (SELECT count(*)::int FROM sent_messages sm
        JOIN enrollments e ON e.id = sm.enrollment_id
        JOIN campaigns c ON c.id = e.campaign_id
        WHERE c.sequence_id = ${sequenceId}) AS sends`);
  const row = refs.rows[0] as { campaigns: number; sends: number };
  if (row.campaigns > 0 || row.sends > 0) {
    return { deleted: false, reason: 'sequence has campaign or sent-message references' };
  }
  const removed = await db
    .delete(sequences)
    .where(eq(sequences.id, sequenceId))
    .returning({ id: sequences.id });
  return { deleted: removed.length === 1 };
}

/** A save violated the after-sends edit policy → 422 sequence_invalid. */
export class SequenceEditConflictError extends Error {
  constructor(readonly details: string[]) {
    super(`sequence edit conflicts with send history: ${details.join('; ')}`);
    this.name = 'SequenceEditConflictError';
  }
}

export interface SequenceSaveInput {
  name: string;
  variableDefaults: Record<string, string>;
  stopOnReply: boolean;
  steps: Array<{
    id?: number;
    stepNo: number;
    waitDays: number;
    inThread: boolean;
    variants: Array<{
      id?: number;
      label: string;
      subjectTemplate: string;
      bodyTemplate: string;
      /** Recomputed by the caller via render/hash on every save (decision Q). */
      contentHash: string;
      active: boolean;
    }>;
  }>;
}

/**
 * PATCH /sequences/:id — replace-set semantics per save (docs/10), with the
 * 2026-07-23 edit policy: literal replace only while the sequence has ZERO
 * sends; once sends exist, steps can be edited/added but not deleted or
 * renumbered, and variants missing from the save are RETIRED (active=false,
 * rows kept) instead of deleted — deleting would orphan variant analytics and
 * punch holes in the content-hash recycle guard. Bespoke (Mode-1) rows are
 * never touched by saves.
 */
export async function updateSequenceReplaceSet(
  db: Db,
  sequenceId: number,
  input: SequenceSaveInput,
  opts: { retireOnly: boolean },
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(sequences)
      .set({
        name: input.name,
        variableDefaults: input.variableDefaults,
        stopOnReply: input.stopOnReply,
        stopOnHardBounce: true,
        stopOnUnsubscribe: true,
      })
      .where(eq(sequences.id, sequenceId));

    const existingSteps = await tx
      .select()
      .from(sequenceSteps)
      .where(eq(sequenceSteps.sequenceId, sequenceId));
    const existingVariants =
      existingSteps.length === 0
        ? []
        : await tx
            .select()
            .from(stepVariants)
            .where(
              inArray(
                stepVariants.stepId,
                existingSteps.map((s) => s.id),
              ),
            );

    const stepById = new Map(existingSteps.map((s) => [s.id, s]));
    const inputStepIds = new Set(input.steps.flatMap((s) => (s.id === undefined ? [] : [s.id])));
    const conflicts: string[] = [];

    for (const s of input.steps) {
      if (s.id !== undefined && !stepById.has(s.id)) {
        conflicts.push(`step id ${s.id} does not belong to sequence ${sequenceId}`);
      }
      if (opts.retireOnly && s.id !== undefined && stepById.get(s.id)!.stepNo !== s.stepNo) {
        conflicts.push(`step ${stepById.get(s.id)!.stepNo} cannot be renumbered after sends`);
      }
    }
    if (opts.retireOnly) {
      for (const s of existingSteps) {
        if (!inputStepIds.has(s.id)) {
          conflicts.push(`step ${s.stepNo} cannot be deleted after sends`);
        }
      }
    }
    if (conflicts.length > 0) throw new SequenceEditConflictError(conflicts);

    // literal mode: drop steps missing from the save (cascade takes variants)
    if (!opts.retireOnly) {
      const missing = existingSteps.filter((s) => !inputStepIds.has(s.id));
      if (missing.length > 0) {
        await tx.delete(sequenceSteps).where(
          inArray(
            sequenceSteps.id,
            missing.map((s) => s.id),
          ),
        );
      }
    }

    for (const s of input.steps) {
      let stepId = s.id;
      if (stepId === undefined) {
        const [row] = await tx
          .insert(sequenceSteps)
          .values({ sequenceId, stepNo: s.stepNo, waitDays: s.waitDays, inThread: s.inThread })
          .returning({ id: sequenceSteps.id });
        stepId = row!.id;
      } else {
        await tx
          .update(sequenceSteps)
          .set({ stepNo: s.stepNo, waitDays: s.waitDays, inThread: s.inThread })
          .where(eq(sequenceSteps.id, stepId));
      }

      const existingHere = existingVariants.filter(
        (v) => v.stepId === stepId && v.attributes.bespoke !== true,
      );
      const inputVariantIds = new Set(
        s.variants.flatMap((v) => (v.id === undefined ? [] : [v.id])),
      );

      for (const v of s.variants) {
        if (v.id === undefined) {
          await tx.insert(stepVariants).values({
            stepId,
            label: v.label,
            subjectTemplate: v.subjectTemplate,
            bodyTemplate: v.bodyTemplate,
            contentHash: v.contentHash,
            active: v.active,
          });
        } else {
          if (!existingHere.some((e) => e.id === v.id)) {
            throw new SequenceEditConflictError([
              `variant id ${v.id} does not belong to step ${s.stepNo}`,
            ]);
          }
          await tx
            .update(stepVariants)
            .set({
              label: v.label,
              subjectTemplate: v.subjectTemplate,
              bodyTemplate: v.bodyTemplate,
              contentHash: v.contentHash,
              active: v.active,
            })
            .where(eq(stepVariants.id, v.id));
        }
      }

      const dropped = existingHere.filter((e) => !inputVariantIds.has(e.id));
      if (dropped.length > 0) {
        if (opts.retireOnly) {
          await tx
            .update(stepVariants)
            .set({ active: false })
            .where(
              inArray(
                stepVariants.id,
                dropped.map((d) => d.id),
              ),
            );
        } else {
          await tx.delete(stepVariants).where(
            inArray(
              stepVariants.id,
              dropped.map((d) => d.id),
            ),
          );
        }
      }
    }
  });
}

/** POST /step-variants/:id/deactivate ("route all to B") + retire path. */
export async function deactivateVariant(db: DbLike, variantId: number): Promise<boolean> {
  const rows = await db
    .update(stepVariants)
    .set({ active: false })
    .where(eq(stepVariants.id, variantId))
    .returning({ id: stepVariants.id });
  return rows.length > 0;
}

/**
 * One-off Mode-1 variant (docs/08 §3): flagged bespoke, never active — the
 * round-robin can't pick it; it exists so the hash + recycle guard apply.
 */
export async function insertBespokeVariant(
  db: DbLike,
  row: {
    stepId: number;
    label: string;
    subjectTemplate: string;
    bodyTemplate: string;
    contentHash: string;
  },
): Promise<number> {
  const [v] = await db
    .insert(stepVariants)
    .values({ ...row, active: false, attributes: { bespoke: true } })
    .returning({ id: stepVariants.id });
  return v!.id;
}
