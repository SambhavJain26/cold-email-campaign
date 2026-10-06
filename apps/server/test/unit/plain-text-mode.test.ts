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
            `Hi Jane,\n\nA note.\n\nBest,\nSambhav Jain\nPM Systems & Automation Specialist | ${domain}\n123 Main St\n\nAustin, TX`,
          );
          expect(stripAutomaticFooter(rendered.bodyText, compliance)).toBe('Hi Jane,\n\nA note.');
        });
      }
    }
  }

  it('inserts the canonical signoff when the body has none', () => {
    const rendered = engine.render({
      ...input,
      variant: { ...input.variant, bodyTemplate: 'One\n\n\nTwo' },
    });
    expect(rendered.bodyText).toMatch(/^One\n\n\nTwo\n\nBest,\nSambhav Jain/);
    expect(rendered.bodyText.match(/Best,/g)).toHaveLength(1);
  });

  it('replaces a terminal legacy signoff and name once in both formats', () => {
    const rendered = engine.render({
      ...input,
      variant: { ...input.variant, bodyTemplate: 'A note.\n\nBest,\nSam' },
      ctx: { ...input.ctx, compliance: { ...input.ctx.compliance, emailFormat: 'minimal_html' } },
    });
    expect(rendered.bodyText.match(/Best,/g)).toHaveLength(1);
    expect(rendered.bodyHtml?.match(/Best,/g)).toHaveLength(1);
    expect(rendered.bodyText).toMatch(/^A note\.\n\nBest,\nSambhav Jain/);
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
    expect(rendered.bodyHtml).toContain(
      'Best,<br>Sambhav Jain<br>PM Systems &amp; Automation Specialist | sambhavpmops.com<br>123 Main St',
    );
    expect(rendered.bodyHtml).not.toContain('reply stop');
    expect(rendered.bodyHtml).not.toContain('<a');
    expect(rendered.bodyText).not.toContain('<strong>');
  });
});
