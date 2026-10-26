// Render engine vocabulary (docs/08). These are the B4 shapes of the
// Renderer seam; scheduler/types re-exports them once the engine is wired
// (B4.8) so downstream imports keep working.
import type { PersonalizationMode } from '@coldemail/shared';

/** What the renderer needs to know about the recipient (subset of leads row). */
export interface LeadLite {
  id: number;
  email: string;
  firstName: string | null;
  company: string | null;
  state: string | null;
}

/** A variant with its templates - domain VariantDef satisfies this once B4.8 widens it. */
export interface TemplateVariant {
  id: number;
  label: string;
  /** sha256(subject_template + '\0' + body_template) - decision Q. Echoed, never recomputed. */
  contentHash: string;
  subjectTemplate: string;
  bodyTemplate: string;
}

/** Caller-loaded context: the renderer itself is pure (docs/08 §0). */
export interface RenderContext {
  mode: PersonalizationMode;
  /** leads.custom_fields - source of {{custom_observation}} in researched mode + arbitrary keys. */
  customFields: Record<string, string>;
  /** campaigns.tier_effort_config.auto_observations - market-keyed segment rule (docs/08 §3). */
  autoObservations: Record<string, string> | null;
  compliance: { physicalAddress: string; optoutText: string };
  /**
   * The rendered step-1 subject: in-thread steps 2+ send `Re: {threadSubject}`
   * (docs/08 §6). Absent → the step renders its own subject (still Re:-prefixed
   * when in-thread past step 1).
   */
  threadSubject?: string;
  /**
   * Mode-1 manual compose (docs/08 §3): subject/body are already literal - 
   * pipeline stages 1-3 are skipped; footer + checks still apply.
   */
  literal?: boolean;
}

export interface RenderInput {
  variant: TemplateVariant;
  step: { stepNo: number; inThread: boolean };
  lead: LeadLite;
  enrollmentId: number;
  ctx: RenderContext;
}

export interface CheckItem {
  /** Stable id, e.g. 'merge_tag', 'url_in_step1', 'spam:guarantee'. */
  id: string;
  message: string;
}

/** docs/08 §5: the pre-send check report + deliverability score (decision W). */
export interface RenderChecks {
  fatal: CheckItem[];
  warnings: CheckItem[];
  /** 0-10, one decimal - deterministic local rubric, no external calls. */
  score: number;
  /** Π of spintax option-counts across subject+body (the "24 unique variations"). */
  variations: number;
}

export interface RenderedMessage {
  subject: string;
  bodyText: string;
  /** Echoes variant.contentHash - stored on the sent event (decision Q). */
  contentHash: string;
  checks: RenderChecks;
}

export interface Renderer {
  render(input: RenderInput): RenderedMessage;
}
