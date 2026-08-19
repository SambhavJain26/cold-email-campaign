// Pre-send checks + deliverability score (docs/08 §5, decision W): a
// deterministic local rubric — no external calls, snapshot-tested. The send
// path asserts `fatal` is empty; previews display everything.
//
// Score: start 10.0; −2.0 per fatal; −0.5 per warning hit for checks #6–#10
// capped at −1.0 per check. Spam starts at −0.8 and costs −0.5 per
// additional weighted hit; a subject-line phrase counts as two hits. Warnings
// outside #6–#10 (step-2+ URLs, observation fallback) are reported but do
// not affect the score. Clamp [0, 10], one decimal.
import { ALL_CAPS_MAX, ALL_CAPS_PATTERN, EXCLAMATION_MAX, SPAM_PHRASES } from './spamwords';
import type { ParsedTemplate } from './template';
import type { CheckItem, RenderChecks } from './types';

const URL_PATTERN = /(https?:\/\/|www\.)/i;
const HTML_PATTERN = /<\/?[a-z][^>]*>/i;
const IMAGE_PATTERN = /!\[[^\]]*\]\([^)]*\)/;

const PERSONALIZATION_FIELDS = new Set(['first_name', 'company', 'custom_observation']);

export interface CheckInputs {
  stepNo: number;
  subjectParse: ParsedTemplate;
  bodyParse: ParsedTemplate;
  /** Collected by the merge resolver during the main expansion pass. */
  mergeFatals: CheckItem[];
  extraWarnings: CheckItem[];
  /** The step's OWN rendered subject (pre-`Re:` override). */
  renderedSubject: string;
  /** Longest-branch subject expansion (check #7 measures the worst case). */
  longestSubject: string;
  /** Rendered body BEFORE the footer (checks #6/#8/#9 measure template content). */
  renderedBodyPreFooter: string;
  compliance: { physicalAddress: string; optoutText: string };
  variations: number;
  /** Mode-1 literal compose: parse/merge/personalization checks don't apply. */
  literal: boolean;
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter((w) => w !== '').length;
}

export function runChecks(inp: CheckInputs): RenderChecks {
  const fatal: CheckItem[] = [];
  const warnings: CheckItem[] = [...inp.extraWarnings];
  const content = `${inp.renderedSubject}\n${inp.renderedBodyPreFooter}`;

  // #1 merge tags parse + resolve; #2 spintax valid — both surface as parse
  // errors / merge fatals.
  for (const e of [...inp.subjectParse.errors, ...inp.bodyParse.errors]) {
    fatal.push({ id: 'template_parse', message: `${e.message} (offset ${e.offset})` });
  }
  fatal.push(...inp.mergeFatals);

  // #3 URLs: fatal in step 1 (walkthrough rule), warning later.
  if (URL_PATTERN.test(content)) {
    if (inp.stepNo === 1)
      fatal.push({ id: 'url_in_step1', message: 'step 1 must not contain URLs' });
    else warnings.push({ id: 'url', message: 'follow-up contains a URL' });
  }

  // #4 footer ingredients present (the engine always appends — this guards
  // empty compliance_settings; the scheduler additionally refuses globally).
  if (inp.compliance.physicalAddress.trim() === '' || inp.compliance.optoutText.trim() === '') {
    fatal.push({
      id: 'footer',
      message: 'compliance footer needs a physical address and opt-out text',
    });
  }

  // #5 plain text only.
  if (HTML_PATTERN.test(content) || IMAGE_PATTERN.test(content)) {
    fatal.push({ id: 'html', message: 'HTML tags / image markup are not allowed' });
  }

  // #6 template duplicates the footer text (canonical one is appended anyway).
  const bodyLower = inp.renderedBodyPreFooter.toLowerCase();
  if (
    (inp.compliance.optoutText.trim() !== '' &&
      bodyLower.includes(inp.compliance.optoutText.trim().toLowerCase())) ||
    (inp.compliance.physicalAddress.trim() !== '' &&
      bodyLower.includes(inp.compliance.physicalAddress.trim().toLowerCase()))
  ) {
    warnings.push({ id: 'footer_duplicate', message: 'body duplicates opt-out/footer text' });
  }

  // #7 subject length — post-expansion, longest spintax branch.
  if (inp.longestSubject.length > 60) {
    warnings.push({
      id: 'subject_length',
      message: `subject may reach ${inp.longestSubject.length} chars (max 60)`,
    });
  }

  // #8 body 40–180 words (pre-footer).
  const words = wordCount(inp.renderedBodyPreFooter);
  if (words < 40 || words > 180) {
    warnings.push({ id: 'body_length', message: `body is ${words} words (want 40–180)` });
  }

  // #9 spam lexicon + structural rules.
  let spamWeight = 0;
  const subjectLower = inp.renderedSubject.toLowerCase();
  const bodyContentLower = inp.renderedBodyPreFooter.toLowerCase();
  for (const phrase of SPAM_PHRASES) {
    const inSubject = subjectLower.includes(phrase);
    const inBody = bodyContentLower.includes(phrase);
    if (inSubject || inBody) {
      spamWeight += inSubject ? 2 : 1;
      warnings.push({
        id: `spam:${phrase}`,
        message: `${inSubject ? 'subject-line ' : ''}copy-risk phrase: "${phrase}"`,
      });
    }
  }
  const caps = content.match(ALL_CAPS_PATTERN) ?? [];
  if (caps.length > ALL_CAPS_MAX) {
    spamWeight += 1;
    warnings.push({
      id: 'spam:all_caps',
      message: `${caps.length} ALL-CAPS words (max ${ALL_CAPS_MAX})`,
    });
  }
  const exclamations = (content.match(/!/g) ?? []).length;
  if (exclamations > EXCLAMATION_MAX) {
    spamWeight += 1;
    warnings.push({
      id: 'spam:exclamations',
      message: `${exclamations} exclamation marks (max ${EXCLAMATION_MAX})`,
    });
  }

  // #10 personalization present (template mode only — bespoke IS personal).
  if (!inp.literal) {
    const personalized = [...inp.subjectParse.tokens, ...inp.bodyParse.tokens].some(
      (t) => t.kind === 'tag' && PERSONALIZATION_FIELDS.has(t.field),
    );
    if (!personalized) {
      warnings.push({
        id: 'no_personalization',
        message: 'no lead-specific merge tag in subject or body',
      });
    }
  }

  // ── Score ────────────────────────────────────────────────────────────────
  let penalty = 2.0 * fatal.length;
  const singleHit = (id: string): number =>
    Math.min(0.5 * warnings.filter((w) => w.id === id).length, 1.0);
  penalty += singleHit('footer_duplicate');
  penalty += singleHit('subject_length');
  penalty += singleHit('body_length');
  penalty += singleHit('no_personalization');
  if (spamWeight > 0) penalty += 0.8 + 0.5 * (spamWeight - 1);

  const score = Math.round(Math.max(0, Math.min(10, 10 - penalty)) * 10) / 10;
  return { fatal, warnings, score, variations: inp.variations };
}
