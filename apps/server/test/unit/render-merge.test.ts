// B4.3: merge-tag expansion + fallbacks — every field's ± fallback case
// (docs/08 §2, §7).
import { describe, expect, it } from 'vitest';
import { makeResolver, expandTokens } from '../../src/render/merge';
import { parseTemplate } from '../../src/render/template';
import { longestPick } from '../../src/render/spintax';
import type { CheckItem, LeadLite, RenderContext } from '../../src/render/types';

const lead: LeadLite = {
  id: 1,
  email: 'jane@acme.dev',
  firstName: 'Jane',
  company: 'Acme Realty',
  state: 'TX',
};

const ctx: RenderContext = {
  mode: 'template_researched',
  customFields: { role: 'broker', empty_field: '   ' },
  autoObservations: null,
  compliance: {
    physicalAddress: '123 Main St, Austin TX',
    optoutText: 'Reply STOP to opt out.',
  },
};

function render(template: string, l = lead, c = ctx, observation: string | null = null) {
  const fatals: CheckItem[] = [];
  const out = expandTokens(
    parseTemplate(template).tokens,
    makeResolver(l, c, observation, fatals),
    longestPick,
  );
  return { out, fatals };
}

describe('field resolution', () => {
  it('first_name / company resolve from the lead', () => {
    expect(render('{{first_name}} at {{company}}').out).toBe('Jane at Acme Realty');
  });

  it('missing first_name uses the fallback', () => {
    const { out, fatals } = render('Hi {{first_name|there}}', { ...lead, firstName: null });
    expect(out).toBe('Hi there');
    expect(fatals).toEqual([]);
  });

  it('missing field with NO fallback is fatal and leaves the raw tag visible', () => {
    const { out, fatals } = render('Hi {{first_name}}', { ...lead, firstName: null });
    expect(out).toBe('Hi {{first_name}}');
    expect(fatals).toEqual([
      { id: 'merge_tag', message: "'first_name' is empty and the tag has no fallback" },
    ]);
  });

  it('empty-after-trim counts as empty (docs/08 §2 fallback rule)', () => {
    const { out } = render('{{first_name|there}}', { ...lead, firstName: '   ' });
    expect(out).toBe('there');
  });

  it('market resolves lead.state to the state name', () => {
    expect(render('growth in {{market|US}}').out).toBe('growth in Texas');
  });

  it('market falls back on unknown or missing state', () => {
    expect(render('{{market|US}}', { ...lead, state: 'ZZ' }).out).toBe('US');
    expect(render('{{market|US}}', { ...lead, state: null }).out).toBe('US');
  });

  it('sender_physical_address always comes from compliance settings', () => {
    expect(render('{{sender_physical_address}}').out).toBe('123 Main St, Austin TX');
  });

  it('custom_observation resolves from the pre-resolved slot value', () => {
    expect(render('{{custom_observation}}', lead, ctx, 'your listings move fast').out).toBe(
      'your listings move fast',
    );
  });

  it('custom_fields keys resolve; whitespace-only value falls through', () => {
    expect(render('as a {{role}}').out).toBe('as a broker');
    expect(render('{{empty_field|fb}}').out).toBe('fb');
  });

  it('unknown field with fallback renders the fallback; without = fatal', () => {
    expect(render('{{nope|fb}}').fatals).toEqual([]);
    expect(render('{{nope|fb}}').out).toBe('fb');
    const { fatals } = render('{{nope}}');
    expect(fatals).toEqual([{ id: 'merge_tag', message: "unknown field 'nope' with no fallback" }]);
  });

  it('resolved values are trimmed', () => {
    expect(render('Hi {{first_name}}!', { ...lead, firstName: '  Jane ' }).out).toBe('Hi Jane!');
  });
});
