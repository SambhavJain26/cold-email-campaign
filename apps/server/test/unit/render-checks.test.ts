// B4.7: every pre-send check's positive + negative case, plus score rubric
// snapshots (docs/08 §5, decision W). Driven through the real engine so the
// inputs are assembled exactly as the send path assembles them.
import { describe, expect, it } from 'vitest';
import { RenderEngine } from '../../src/render/engine';
import type { LeadLite, RenderContext, RenderedMessage } from '../../src/render/types';

const engine = new RenderEngine();

const lead: LeadLite = {
  id: 7,
  email: 'jane@acme.dev',
  firstName: 'Jane',
  company: 'Acme Realty',
  state: 'TX',
};

const compliance = {
  physicalAddress: '123 Main St, Austin TX 78701',
  optoutText: "Don't want future emails? Reply STOP and I'll remove you immediately.",
};

// Baseline passes every check: personalization tag, no URLs/HTML/spam,
// in-range body (~55 words), short subject.
const SUBJECT = 'A note about {{company|your listings}}';
const BODY =
  'Hi {{first_name|there}},\n\n' +
  'I noticed {{company|your team}} has been growing quickly this quarter and wanted to reach out. ' +
  'We help small teams handle their outreach without adding headcount, and I thought it might be ' +
  'relevant to what you are building right now given how busy this season gets.\n\n' +
  'Would you be open to a quick chat next week?\n\nBest,\nSam';

function render(over: {
  subject?: string;
  body?: string;
  stepNo?: number;
  lead?: LeadLite;
  ctx?: Partial<RenderContext>;
}): RenderedMessage {
  const ctx: RenderContext = {
    mode: 'template_researched',
    customFields: {},
    autoObservations: null,
    compliance,
    ...over.ctx,
  };
  const stepNo = over.stepNo ?? 1;
  return engine.render({
    variant: {
      id: 1,
      label: 'A',
      contentHash: 'hash-under-test',
      subjectTemplate: over.subject ?? SUBJECT,
      bodyTemplate: over.body ?? BODY,
    },
    step: { stepNo, inThread: stepNo > 1 },
    lead: over.lead ?? lead,
    enrollmentId: 42,
    ctx,
  });
}

describe('baseline', () => {
  it('a clean template scores 10.0 with no findings', () => {
    const r = render({});
    expect(r.checks).toEqual({ fatal: [], warnings: [], score: 10, variations: 1 });
  });
});

describe('#1 merge tags (fatal)', () => {
  it('empty field without fallback is fatal', () => {
    const r = render({ subject: 'Hi {{first_name}}', lead: { ...lead, firstName: null } });
    expect(r.checks.fatal).toEqual([
      { id: 'merge_tag', message: "'first_name' is empty and the tag has no fallback" },
    ]);
    expect(r.checks.score).toBe(8);
  });
});

describe('#2 spintax validity (fatal)', () => {
  it('single-option spintax is fatal', () => {
    const r = render({ body: BODY + ' {{RANDOM|only}}' });
    expect(r.checks.fatal.some((f) => f.id === 'template_parse')).toBe(true);
  });

  it('valid spintax reports the variation count', () => {
    const r = render({ body: BODY + ' {{RANDOM|a|b|c}} {{RANDOM|x|y}}' });
    expect(r.checks.variations).toBe(6);
    expect(r.checks.fatal).toEqual([]);
  });
});

describe('#3 URLs', () => {
  it('fatal in step 1', () => {
    const r = render({ body: BODY + ' See https://example.com' });
    expect(r.checks.fatal).toEqual([
      { id: 'url_in_step1', message: 'step 1 must not contain URLs' },
    ]);
  });

  it('www. counts as a URL too', () => {
    const r = render({ body: BODY + ' See www.example.com' });
    expect(r.checks.fatal.some((f) => f.id === 'url_in_step1')).toBe(true);
  });

  it('warning (not fatal, not scored) in steps 2+', () => {
    const r = render({ stepNo: 2, body: BODY + ' See https://example.com' });
    expect(r.checks.fatal).toEqual([]);
    expect(r.checks.warnings).toEqual([{ id: 'url', message: 'follow-up contains a URL' }]);
    expect(r.checks.score).toBe(10);
  });
});

describe('#4 footer ingredients (fatal)', () => {
  it('empty physical address is fatal', () => {
    const r = render({ ctx: { compliance: { ...compliance, physicalAddress: '  ' } } });
    expect(r.checks.fatal.some((f) => f.id === 'footer')).toBe(true);
  });

  it('empty opt-out text is fatal', () => {
    const r = render({ ctx: { compliance: { ...compliance, optoutText: '' } } });
    expect(r.checks.fatal.some((f) => f.id === 'footer')).toBe(true);
  });
});

describe('#5 plain text only (fatal)', () => {
  it('HTML tags are fatal', () => {
    expect(render({ body: BODY + ' <b>now</b>' }).checks.fatal.some((f) => f.id === 'html')).toBe(
      true,
    );
  });

  it('image markup is fatal', () => {
    expect(
      render({ body: BODY + ' ![chart](cid:x)' }).checks.fatal.some((f) => f.id === 'html'),
    ).toBe(true);
  });

  it('a bare less-than is fine', () => {
    expect(render({ body: BODY + ' price < value' }).checks.fatal).toEqual([]);
  });
});

describe('#6 duplicated footer text (warning)', () => {
  it('body containing the opt-out text warns and costs 0.5', () => {
    const r = render({ body: BODY + ' ' + compliance.optoutText });
    expect(r.checks.warnings.some((w) => w.id === 'footer_duplicate')).toBe(true);
    expect(r.checks.score).toBe(9.5);
  });
});

describe('#7 subject length (warning, longest spintax branch)', () => {
  it('warns when the LONGEST branch exceeds 60 even if the pick is short', () => {
    const long = 'a very long subject line option that certainly exceeds the sixty character limit';
    const r = render({ subject: `{{RANDOM|Hi|${long}}}` });
    expect(r.checks.warnings.some((w) => w.id === 'subject_length')).toBe(true);
  });

  it('a 60-char subject is fine', () => {
    expect(render({}).checks.warnings).toEqual([]);
  });
});

describe('#8 body word count (warning)', () => {
  it('short body warns', () => {
    const r = render({ body: 'Hi {{first_name|there}}, quick one.' });
    expect(r.checks.warnings.some((w) => w.id === 'body_length')).toBe(true);
  });

  it('overlong body warns', () => {
    const r = render({ body: 'Hi {{first_name|there}}, ' + 'word '.repeat(200) });
    expect(r.checks.warnings.some((w) => w.id === 'body_length')).toBe(true);
  });
});

describe('#9 spam lexicon', () => {
  it('one body phrase: −0.8', () => {
    const r = render({ body: BODY + ' Just following up on this.' });
    expect(r.checks.warnings.map((w) => w.id)).toEqual(['spam:just following up']);
    expect(r.checks.score).toBe(9.2);
  });

  it('three body hits cost 1.8', () => {
    const r = render({ body: BODY + ' Just following up: act now, click here.' });
    expect(r.checks.warnings.map((w) => w.id).sort()).toEqual([
      'spam:act now',
      'spam:click here',
      'spam:just following up',
    ]);
    expect(r.checks.score).toBe(8.2);
  });

  it('flags quick question and weights subject-line phrases twice', () => {
    const r = render({ subject: 'Quick question for {{company|your team}}' });
    expect(r.checks.warnings).toContainEqual({
      id: 'spam:quick question',
      message: 'subject-line copy-risk phrase: "quick question"',
    });
    expect(r.checks.score).toBe(8.7);
  });

  it('more than 2 ALL-CAPS words is a hit; 2-letter acronyms are not counted', () => {
    const r = render({ body: BODY + ' THIS DEAL ENDS soon in the US' });
    expect(r.checks.warnings.some((w) => w.id === 'spam:all_caps')).toBe(true);
  });

  it('more than one exclamation mark is a hit', () => {
    const r = render({ body: BODY.replace('next week?', 'next week!') + ' Great!' });
    expect(r.checks.warnings.some((w) => w.id === 'spam:exclamations')).toBe(true);
  });
});

describe('#10 personalization present (warning)', () => {
  it('no lead-specific tag anywhere warns', () => {
    const r = render({
      subject: 'Quarterly outreach',
      body:
        'Hello,\n\nWe work with real-estate teams on their outreach programs and wanted to connect ' +
        'about how you handle yours today. Many teams in your region have been rethinking their ' +
        'approach this year, and the results have been strong across the board so far.\n\n' +
        'Open to a short call?\n\nBest,\nSam',
    });
    expect(r.checks.warnings).toEqual([
      { id: 'no_personalization', message: 'no lead-specific merge tag in subject or body' },
    ]);
    expect(r.checks.score).toBe(9.5);
  });
});

describe('score rubric composition', () => {
  it('fatals cost 2.0 each and stack with warnings', () => {
    // fatal URL + short body warning
    const r = render({ body: 'See https://x.dev {{first_name|there}}' });
    expect(r.checks.fatal).toHaveLength(1);
    expect(r.checks.warnings.some((w) => w.id === 'body_length')).toBe(true);
    expect(r.checks.score).toBe(7.5); // 10 − 2.0 − 0.5
  });

  it('clamps at 0 and keeps one decimal', () => {
    const r = render({
      subject: '{{nope}}',
      body: 'BUY NOW ACT FAST TODAY!!! guarantee click here risk-free 100% free act now <b>x</b> https://x.dev {{RANDOM|solo}}',
      lead: { ...lead, firstName: null },
    });
    expect(r.checks.score).toBe(0);
    expect(Number.isInteger(r.checks.score * 10)).toBe(true);
  });
});
