// The render engine (docs/08 §1): the ONLY producer of outbound message
// bodies. Pure — every input (templates, lead, compliance settings, segment
// rules) is loaded by the caller and passed in.
//
//   1. resolve slots        (slots.ts — {{custom_observation}} per mode)
//   2. expand merge tags    (merge.ts)
//   3. expand spintax       (spintax.ts — seeded, subject then body)
//   4. append footer        (footer.ts — unconditional, body only)
//   5. run pre-send checks  (checks.ts — send path asserts fatals empty)
//
// Threading subjects (docs/08 §6): in-thread steps 2+ send `Re: {step-1
// subject}` via ctx.threadSubject; absent → `Re:` on the step's own subject.
import { expandTokens, makeResolver } from './merge';
import { appendFooter, footerHtml, signatureHtml } from './footer';
import { htmlOfText } from './html';
import { runChecks } from './checks';
import { resolveObservation } from './slots';
import { spintaxRng } from './seed';
import { longestPick, seededPick } from './spintax';
import { parseTemplate, variationCount, type ParsedTemplate } from './template';
import type { CheckItem, RenderInput, RenderedMessage, Renderer } from './types';

const EMPTY_PARSE: ParsedTemplate = { tokens: [], errors: [] };

export class RenderEngine implements Renderer {
  render(input: RenderInput): RenderedMessage {
    const { variant, step, lead, enrollmentId, ctx } = input;
    const emailFormat = ctx.compliance.emailFormat ?? 'plain_text';
    const html = (body: string) =>
      emailFormat === 'minimal_html'
        ? htmlOfText(body, footerHtml(ctx.compliance), signatureHtml(ctx.compliance))
        : undefined;

    // Mode-1 manual compose (docs/08 §3): text is already literal — stages
    // 1–3 are skipped; footer + checks still apply.
    if (ctx.literal) {
      const subject = this.threadedSubject(input, variant.subjectTemplate);
      const bodyText = appendFooter(variant.bodyTemplate, ctx.compliance);
      return {
        subject,
        bodyText,
        bodyHtml: html(variant.bodyTemplate),
        emailFormat,
        contentHash: variant.contentHash,
        checks: runChecks({
          stepNo: step.stepNo,
          subjectParse: EMPTY_PARSE,
          bodyParse: EMPTY_PARSE,
          mergeFatals: [],
          extraWarnings: [],
          renderedSubject: variant.subjectTemplate,
          longestSubject: variant.subjectTemplate,
          renderedBodyPreFooter: variant.bodyTemplate,
          compliance: ctx.compliance,
          variations: 1,
          literal: true,
        }),
      };
    }

    const observation = resolveObservation(lead, ctx);
    const subjectParse = parseTemplate(variant.subjectTemplate);
    const bodyParse = parseTemplate(variant.bodyTemplate);

    const mergeFatals: CheckItem[] = [];
    const resolve = makeResolver(lead, ctx, observation.value, mergeFatals);
    // ONE seeded stream per send: subject tokens first, then body, in document
    // order — a soft-bounce retry renders byte-identical text (docs/08 §2).
    const pick = seededPick(spintaxRng(enrollmentId, step.stepNo, variant.id));
    const ownSubject = expandTokens(subjectParse.tokens, resolve, pick);
    const bodyPreFooter = expandTokens(bodyParse.tokens, resolve, pick);

    // Longest-branch subject for check #7 — fatals here would double-count,
    // so this pass gets a throwaway collector.
    const longestSubject = expandTokens(
      subjectParse.tokens,
      makeResolver(lead, ctx, observation.value, []),
      longestPick,
    );

    const bodyText = appendFooter(bodyPreFooter, ctx.compliance);
    return {
      subject: this.threadedSubject(input, ownSubject),
      bodyText,
      bodyHtml: html(bodyPreFooter),
      emailFormat,
      contentHash: variant.contentHash,
      checks: runChecks({
        stepNo: step.stepNo,
        subjectParse,
        bodyParse,
        mergeFatals,
        extraWarnings: observation.warning ? [observation.warning] : [],
        renderedSubject: ownSubject,
        longestSubject,
        renderedBodyPreFooter: bodyPreFooter,
        compliance: ctx.compliance,
        variations: variationCount(subjectParse, bodyParse),
        literal: false,
      }),
    };
  }

  private threadedSubject(input: RenderInput, ownSubject: string): string {
    const { step, ctx } = input;
    if (!step.inThread || step.stepNo <= 1) return ownSubject;
    return `Re: ${ctx.threadSubject ?? ownSubject}`;
  }
}
