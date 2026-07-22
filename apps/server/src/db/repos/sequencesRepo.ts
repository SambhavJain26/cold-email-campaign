import { and, asc, eq, inArray } from 'drizzle-orm';
import type { DbLike } from '../client';
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
    .select({ id: sequences.id })
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
  const [seq] = await db.insert(sequences).values({ name: input.name }).returning({
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
