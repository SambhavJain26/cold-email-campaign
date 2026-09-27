import { describe, expect, it } from 'vitest';
import { RenderEngine } from '../../src/render/engine';
import { stripAutomaticFooter } from '../../src/render/footer';
import type { RenderInput } from '../../src/render/types';

const engine = new RenderEngine();
const input: RenderInput = {
  variant: {
    id: 1,
    label: 'A',
    contentHash: 'fixture',
    subjectTemplate: 'Hello',
    bodyTemplate: 'Hi Jane,\n\nA note.\n\nBest,  \n\n',
  },
  step: { stepNo: 1, inThread: false },
  lead: { id: 1, email: 'jane@example.com', firstName: 'Jane', company: null, state: null },
  enrollmentId: 1,
  ctx: {
    mode: 'template_researched',
    customFields: {},
    autoObservations: null,
    compliance: {
      physicalAddress: '123 Main St\n\nAustin, TX',
      optoutText: "Prefer I don't reach out? Just let me know or reply stop.",
    },
  },
};

describe('plain-text mode', () => {
  for (const literal of [false, true]) {
    for (const domain of ['sambhavpmtech.com', 'sambhavpmops.com']) {
      for (const unsubscribeUrl of ['', 'https://unsubscribe.example.com/u/test']) {
        it(`renders exact whitespace: literal=${literal}, ${domain}, link=${Boolean(unsubscribeUrl)}`, () => {
          const compliance = { ...input.ctx.compliance, senderDomain: domain, unsubscribeUrl };
          const rendered = engine.render({ ...input, ctx: { ...input.ctx, literal, compliance } });
          expect(rendered.emailFormat).toBe('plain_text');
          expect(rendered.bodyHtml).toBeUndefined();
          expect(rendered.bodyText).toBe(
            `Hi Jane,\n\nA note.\n\nBest,\nSambhav Jain\nAutomation Specialist\n${domain}\n\n${unsubscribeUrl ? `Unsubscribe: ${unsubscribeUrl}` : compliance.optoutText}\n123 Main St\n\nAustin, TX`,
          );
          expect(stripAutomaticFooter(rendered.bodyText, compliance)).toBe(
            'Hi Jane,\n\nA note.\n\nBest,',
          );
        });
      }
    }
  }

  it('does not insert Best and keeps a blank line before identity without that closing', () => {
    const rendered = engine.render({
      ...input,
      variant: { ...input.variant, bodyTemplate: 'One\n\n\nTwo' },
    });
    expect(rendered.bodyText).toMatch(/^One\n\n\nTwo\n\nSambhav Jain/);
    expect(rendered.bodyText).not.toContain('Best,');
  });

  it('keeps minimal HTML styling and attaches identity directly below Best on follow-ups', () => {
    const rendered = engine.render({
      ...input,
      step: { stepNo: 2, inThread: true },
      ctx: {
        ...input.ctx,
        threadSubject: 'Original',
        compliance: {
          ...input.ctx.compliance,
          emailFormat: 'minimal_html',
          senderDomain: 'sambhavpmops.com',
        },
      },
    });
    expect(rendered.subject).toBe('Re: Original');
    expect(rendered.bodyHtml).toContain('Best,<br><strong>Sambhav Jain</strong>');
    expect(rendered.bodyHtml).toContain('font-size:10px;color:#767676');
    expect(rendered.bodyHtml).toContain('margin-top:20px');
    expect(rendered.bodyHtml).not.toContain('<a');
    expect(rendered.bodyText).not.toContain('<strong>');
  });
});
