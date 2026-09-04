// B4.6/B4.11: engine pipeline — snapshot matrix across modes and missing
// fields, footer-always-present (incl. adversarial template), seed
// determinism, threading subjects, literal (Mode-1) path. docs/08 §7.
import { describe, expect, it } from 'vitest';
import { RenderEngine } from '../../src/render/engine';
import type { LeadLite, RenderContext, RenderInput } from '../../src/render/types';

const engine = new RenderEngine();

const fullLead: LeadLite = {
  id: 1,
  email: 'jane@acme.dev',
  firstName: 'Jane',
  company: 'Acme Realty',
  state: 'TX',
};

const compliance = {
  physicalAddress: '123 Main St, Austin TX 78701',
  optoutText: "Don't want future emails? Reply STOP and I'll remove you immediately.",
};

const FOOTER = `\n\n${compliance.optoutText}\n${compliance.physicalAddress}`;

const SUBJECT = 'Quick question about {{company|your listings}}';
const BODY =
  'Hi {{first_name|there}}, {{custom_observation|hope business is good}} — ' +
  'we help teams in {{market|your area}} with outreach.';

function input(over: {
  lead?: Partial<LeadLite>;
  ctx?: Partial<RenderContext>;
  subject?: string;
  body?: string;
  stepNo?: number;
  inThread?: boolean;
  enrollmentId?: number;
  variantId?: number;
}): RenderInput {
  return {
    variant: {
      id: over.variantId ?? 1,
      label: 'A',
      contentHash: 'sha-fixture',
      subjectTemplate: over.subject ?? SUBJECT,
      bodyTemplate: over.body ?? BODY,
    },
    step: { stepNo: over.stepNo ?? 1, inThread: over.inThread ?? (over.stepNo ?? 1) > 1 },
    lead: { ...fullLead, ...over.lead },
    enrollmentId: over.enrollmentId ?? 10,
    ctx: {
      mode: 'template_researched',
      customFields: { custom_observation: 'saw your Q2 listings report' },
      autoObservations: { TX: 'your listings move fast in Texas', default: 'your market is busy' },
      compliance,
      ...over.ctx,
    },
  };
}

describe('render matrix (docs/08 §7 snapshots)', () => {
  it('lead-with-everything, researched mode', () => {
    const r = engine.render(input({}));
    expect(r.subject).toBe('Quick question about Acme Realty');
    expect(r.bodyText).toBe(
      'Hi Jane, saw your Q2 listings report — we help teams in Texas with outreach.' + FOOTER,
    );
    expect(r.contentHash).toBe('sha-fixture'); // echoed, never recomputed
    expect(r.checks.fatal).toEqual([]);
  });

  it('missing first_name and company fall back', () => {
    const r = engine.render(input({ lead: { firstName: null, company: null } }));
    expect(r.subject).toBe('Quick question about your listings');
    expect(r.bodyText.startsWith('Hi there, ')).toBe(true);
  });

  it('researched mode with empty observation falls to the segment rule + warning', () => {
    const r = engine.render(input({ ctx: { customFields: {} } }));
    expect(r.bodyText).toContain('Hi Jane, your listings move fast in Texas — ');
    expect(r.checks.warnings.some((w) => w.id === 'observation_fallback')).toBe(true);
  });

  it('auto mode ignores custom_fields and uses the segment rule', () => {
    const r = engine.render(input({ ctx: { mode: 'template_auto' } }));
    expect(r.bodyText).toContain('your listings move fast in Texas');
  });

  it('auto mode without any table: observation tag falls back per-tag, else fatal', () => {
    const withFallback = engine.render(
      input({ ctx: { mode: 'template_auto', autoObservations: null } }),
    );
    expect(withFallback.bodyText).toContain('hope business is good');
    const noFallback = engine.render(
      input({
        body: 'Hi {{first_name|there}}, {{custom_observation}}.',
        ctx: { mode: 'template_auto', autoObservations: null },
      }),
    );
    expect(noFallback.checks.fatal.some((f) => f.id === 'merge_tag')).toBe(true);
  });
});

describe('footer is unconditional (docs/08 §4)', () => {
  it('every render ends with the canonical footer', () => {
    expect(engine.render(input({})).bodyText.endsWith(FOOTER)).toBe(true);
  });

  it('adversarial template: a fake footer just gets the real one appended (+ dup warning)', () => {
    const r = engine.render(
      input({
        body: `Hi {{first_name|there}}.\n\n---\n${compliance.physicalAddress}\n${compliance.optoutText}`,
      }),
    );
    expect(r.bodyText.endsWith(FOOTER)).toBe(true);
    // the fake one is still in the body — the canonical footer follows it
    expect(r.bodyText.match(/---/g)).toHaveLength(1);
    expect(r.checks.warnings.some((w) => w.id === 'footer_duplicate')).toBe(true);
  });

  it('subject never gets the footer', () => {
    expect(engine.render(input({})).subject).not.toContain('---');
  });

  it('creates a matching escaped minimal HTML alternative with an email-safe footer block', () => {
    const r = engine.render(
      input({ body: 'Hi {{first_name|there}}, <unsafe>\n\nSecond paragraph.' }),
    );
    expect(r.bodyHtml).toContain('<p style="margin:0 0 16px">Hi Jane, &lt;unsafe&gt;</p>');
    expect(r.bodyHtml).toContain('<p style="margin:0 0 0">Second paragraph.</p>');
    expect(r.bodyHtml.startsWith('<p style="margin:0')).toBe(true);
    expect(r.bodyHtml).toContain('<table role="presentation"');
    expect(r.bodyHtml).toContain('font-size:10px');
    expect(r.bodyHtml).toContain('color:#595959');
    expect(r.bodyHtml).toContain('margin-top:20px');
    expect(r.bodyHtml).toContain('123 Main St');
    expect(r.bodyHtml).not.toContain('<unsafe>');
  });
});

// The unsubscribe URL is minted per send by the CALLER (scheduler) and handed
// to the renderer; the engine only decides how it appears. Dormant is the
// default state until a real sending domain exists.
describe('unsubscribe link in the footer (0010, docs/16 §8)', () => {
  const URL = 'https://unsubscribe.example.com/u/tok123';
  const withLink = () =>
    engine.render(input({ ctx: { compliance: { ...compliance, unsubscribeUrl: URL } } }));

  it('dormant: no URL configured → operator opt-out text, no link, no scheme', () => {
    const r = engine.render(input({}));
    expect(r.bodyText).toContain(`${compliance.optoutText}\n${compliance.physicalAddress}`);
    expect(r.bodyText).not.toContain('https://');
    expect(r.bodyHtml).not.toContain('<a href');
  });

  it('live: the plain-text part carries only the raw URL and address', () => {
    expect(withLink().bodyText).toContain(`Unsubscribe: ${URL}\n${compliance.physicalAddress}`);
    expect(withLink().bodyText).not.toContain('or reply STOP');
  });

  it('live: the HTML part says the SAME thing with the word linked', () => {
    const html = withLink().bodyHtml;
    expect(html).toContain(
      `<a href="${URL}" style="color:#595959;text-decoration:none;font-weight:700">Unsubscribe</a>`,
    );
    expect(html).toContain(`</a><br>${compliance.physicalAddress}`);
    expect(html).not.toContain('or reply STOP');
    expect(html).not.toContain('aria-hidden');
    expect(html).toContain(compliance.physicalAddress);
    // De-emphasised but legible — CAN-SPAM "clear and conspicuous".
    expect(html).toContain('font-size:10px');
    expect(html).not.toContain('#1155cc');
    expect(html).not.toContain('text-decoration:underline');
  });

  it('the two parts stay semantically identical (finding 19)', () => {
    const r = withLink();
    const textFooter = r.bodyText.slice(r.bodyText.lastIndexOf('\n\n') + 2);
    const htmlFooter = r.bodyHtml.slice(r.bodyHtml.lastIndexOf('<table role='));
    for (const fragment of ['Unsubscribe', compliance.physicalAddress, URL]) {
      expect(textFooter).toContain(fragment);
      expect(htmlFooter).toContain(fragment);
    }
  });

  it('uses no quote/signature marker, hidden content, or invisible-character variation', () => {
    const html = withLink().bodyHtml;
    expect(html).not.toContain('<blockquote');
    expect(html).not.toContain('gmail_quote');
    expect(html).not.toContain('display:none');
    expect(html).not.toMatch(/(?:\u200B|\u200C|\u200D|\u2060|\uFEFF)/u);
    expect(html).toContain('<table role="presentation"');
  });

  it('a hostile URL cannot break out of the anchor', () => {
    const r = engine.render(
      input({
        ctx: { compliance: { ...compliance, unsubscribeUrl: 'https://x.test/u/"><script>bad' } },
      }),
    );
    expect(r.bodyHtml).not.toContain('<script>');
    expect(r.bodyHtml).toContain('&quot;&gt;&lt;script&gt;');
  });

  it('the footer URL does NOT trip the step-1 fatal URL check', () => {
    const r = withLink();
    expect(r.checks.fatal.map((f) => f.id)).not.toContain('url_in_step1');
  });
});

describe('spintax seed determinism (docs/08 §2)', () => {
  const SPIN_BODY = 'Hi {{first_name|there}} {{RANDOM|a|b|c|d|e|f}}{{RANDOM|1|2|3|4|5|6}}';

  it('same (enrollment, step, variant) renders identically — soft-retry safety', () => {
    const a = engine.render(input({ body: SPIN_BODY }));
    const b = engine.render(input({ body: SPIN_BODY }));
    expect(a.bodyText).toBe(b.bodyText);
    expect(a.subject).toBe(b.subject);
  });

  it('picks do not depend on lead data', () => {
    const a = engine.render(input({ body: SPIN_BODY }));
    const b = engine.render(input({ body: SPIN_BODY, lead: { firstName: null } }));
    // strip the greeting difference; the spintax suffix must match
    expect(a.bodyText.slice(-20)).toBe(b.bodyText.slice(-20));
  });

  it('different enrollments eventually pick differently', () => {
    const outputs = new Set<string>();
    for (let e = 1; e <= 30; e++) {
      outputs.add(engine.render(input({ body: SPIN_BODY, enrollmentId: e })).bodyText);
    }
    expect(outputs.size).toBeGreaterThan(1);
  });

  it('different variants of the same step pick independently', () => {
    const a = engine.render(input({ body: SPIN_BODY, variantId: 1 }));
    const outputs = new Set([a.bodyText]);
    for (let v = 2; v <= 20; v++) {
      outputs.add(engine.render(input({ body: SPIN_BODY, variantId: v })).bodyText);
    }
    expect(outputs.size).toBeGreaterThan(1);
  });
});

describe('threading subjects (docs/08 §6)', () => {
  it('step 1 renders its own subject', () => {
    expect(engine.render(input({ stepNo: 1 })).subject).toBe('Quick question about Acme Realty');
  });

  it('in-thread step 2 sends Re: + the step-1 subject from ctx', () => {
    const r = engine.render(
      input({ stepNo: 2, ctx: { threadSubject: 'Quick question about Acme Realty' } }),
    );
    expect(r.subject).toBe('Re: Quick question about Acme Realty');
  });

  it('in-thread step 2 without ctx.threadSubject degrades to Re: own subject', () => {
    expect(engine.render(input({ stepNo: 2 })).subject).toBe(
      'Re: Quick question about Acme Realty',
    );
  });

  it('a non-threaded later step starts fresh — no Re:', () => {
    const r = engine.render(input({ stepNo: 3, inThread: false, ctx: { threadSubject: 'Old' } }));
    expect(r.subject).toBe('Quick question about Acme Realty');
  });
});

describe('literal mode — Mode-1 manual compose (docs/08 §3)', () => {
  it('text passes through verbatim (no parsing), footer + checks still apply', () => {
    const r = engine.render(
      input({
        subject: 'Loved your {{talk at the summit', // would be a parse error in template mode
        body: 'Hey Jane — this is a fully bespoke note about {{whatever.',
        ctx: { literal: true },
      }),
    );
    expect(r.subject).toBe('Loved your {{talk at the summit');
    expect(r.bodyText).toBe('Hey Jane — this is a fully bespoke note about {{whatever.' + FOOTER);
    expect(r.checks.fatal).toEqual([]);
    // #10 personalization is skipped for bespoke; #8 word count still runs
    expect(r.checks.warnings.map((w) => w.id)).toEqual(['body_length']);
  });

  it('literal mode still refuses URLs in step 1 and empty compliance', () => {
    const r = engine.render(
      input({
        body: 'See https://mysite.dev',
        ctx: { literal: true, compliance: { physicalAddress: '', optoutText: '' } },
      }),
    );
    expect(r.checks.fatal.map((f) => f.id).sort()).toEqual(['footer', 'url_in_step1']);
  });
});
