// B4.5: {{custom_observation}} slot resolution per personalization mode
// (docs/08 §3), incl. the auto_observations segment rule.
import { describe, expect, it } from 'vitest';
import { resolveObservation } from '../../src/render/slots';
import type { LeadLite, RenderContext } from '../../src/render/types';

const lead: LeadLite = {
  id: 1,
  email: 'x@y.dev',
  firstName: 'Jo',
  company: 'Acme',
  state: 'TX',
};

const compliance = { physicalAddress: 'addr', optoutText: 'stop' };
const autoObservations = {
  TX: 'your listings move fast in Texas',
  default: 'your market is heating up',
};

function ctx(overrides: Partial<RenderContext>): RenderContext {
  return {
    mode: 'template_auto',
    customFields: {},
    autoObservations: null,
    compliance,
    ...overrides,
  };
}

describe('template_auto (Mode 2b)', () => {
  it('uses the market-keyed segment rule', () => {
    expect(resolveObservation(lead, ctx({ autoObservations }))).toEqual({
      value: 'your listings move fast in Texas',
    });
  });

  it("falls back to the 'default' key for unmapped states", () => {
    expect(resolveObservation({ ...lead, state: 'VT' }, ctx({ autoObservations })).value).toBe(
      'your market is heating up',
    );
    expect(resolveObservation({ ...lead, state: null }, ctx({ autoObservations })).value).toBe(
      'your market is heating up',
    );
  });

  it('no table at all → null (fatal downstream if the tag has no fallback)', () => {
    expect(resolveObservation(lead, ctx({})).value).toBeNull();
  });

  it('matches a selected custom field after trimming and case-folding', () => {
    const r = resolveObservation(
      { ...lead, state: null },
      ctx({
        autoObservationField: 'industry',
        customFields: { industry: '  SaaS  ' },
        autoObservations: {
          saas: 'noticed your product-led motion',
          default: 'noticed your recent growth',
        },
      }),
    );
    expect(r.value).toBe('noticed your product-led motion');
  });

  it('uses the required default when the chosen field is blank or unmatched', () => {
    const config = ctx({
      autoObservationField: 'industry',
      customFields: { industry: 'services' },
      autoObservations: { saas: 'SaaS match', default: 'default observation' },
    });
    expect(resolveObservation(lead, config).value).toBe('default observation');
  });
});

describe('template_researched (Mode 2a)', () => {
  it('uses leads.custom_fields.custom_observation', () => {
    const r = resolveObservation(
      lead,
      ctx({
        mode: 'template_researched',
        customFields: { custom_observation: 'saw your Q2 report' },
      }),
    );
    expect(r).toEqual({ value: 'saw your Q2 report' });
  });

  it('empty → segment rule + warning check (docs/08 §3)', () => {
    const r = resolveObservation(
      lead,
      ctx({
        mode: 'template_researched',
        customFields: { custom_observation: '  ' },
        autoObservations,
      }),
    );
    expect(r.value).toBe('your listings move fast in Texas');
    expect(r.warning?.id).toBe('observation_fallback');
  });

  it('empty and no segment rule → null, no warning', () => {
    const r = resolveObservation(lead, ctx({ mode: 'template_researched' }));
    expect(r).toEqual({ value: null });
  });
});

describe('human_written (Mode 1 template-driven follow-ups)', () => {
  it('behaves like researched: custom field first, then segment rule', () => {
    expect(
      resolveObservation(
        lead,
        ctx({ mode: 'human_written', customFields: { custom_observation: 'loved the webinar' } }),
      ).value,
    ).toBe('loved the webinar');
    const fallback = resolveObservation(lead, ctx({ mode: 'human_written', autoObservations }));
    expect(fallback.value).toBe('your listings move fast in Texas');
    expect(fallback.warning?.id).toBe('observation_fallback');
  });
});
