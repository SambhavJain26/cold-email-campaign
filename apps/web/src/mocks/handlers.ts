// F0.4 — MSW handlers for EVERY endpoint in the docs/10 manifest, served from
// the in-memory golden-fixture state (db.ts). Mutations mutate that state so
// flows work end-to-end offline: enroll decrements capacity, tagging moves the
// positive rate, etc. Request bodies are parsed with the SHARED zod schemas —
// same validation the real server runs (decision H).
import { http, HttpResponse, type RequestHandler } from 'msw';
import {
  bulkTierBodySchema,
  createLeadBodySchema,
  changePasswordBodySchema,
  commitImportBodySchema,
  complianceSchema,
  createCampaignBodySchema,
  createMailboxBodySchema,
  createReminderBodySchema,
  deleteCampaignBodySchema,
  deleteSequenceBodySchema,
  deleteSuppressionBodySchema,
  dispositionReplyBodySchema,
  eraseLeadBodySchema,
  loginBodySchema,
  manualSendBodySchema,
  patchCampaignBodySchema,
  patchLeadBodySchema,
  patchMailboxBodySchema,
  patchReminderBodySchema,
  previewBodySchema,
  putSettingsBodySchema,
  rebuildBodySchema,
  reconnectMailboxBodySchema,
  recycleBodySchema,
  resumeMailboxBodySchema,
  sequenceWriteBodySchema,
  snoozeBodySchema,
  tagSentimentBodySchema,
  validateTemplateBodySchema,
  type ApiErrorCode,
  type LeadDto,
  type MailboxDto,
  type SequenceDto,
  type UniboxItemDto,
} from '@coldemail/shared';
import { buildTimeline, db, persistSession, NOW } from './db';

const BASE = '/api/v1';

function err(code: ApiErrorCode, message: string, status: number, details?: unknown) {
  return HttpResponse.json(
    { error: details === undefined ? { code, message } : { code, message, details } },
    { status },
  );
}

const unauthorized = () => err('unauthorized', 'authentication required', 401);
const notFound = (what: string) => err('not_found', `${what} not found`, 404);

/** Every non-auth route 401s without the mock session — same as the real API. */
function authed(
  resolver: (info: {
    request: Request;
    params: Record<string, string>;
  }) => Response | Promise<Response>,
) {
  return (info: {
    request: Request;
    params: Record<string, string | readonly string[] | undefined>;
  }) => {
    if (!db.authenticated) return unauthorized();
    return resolver(info as { request: Request; params: Record<string, string> });
  };
}

async function parseBody<T>(
  request: Request,
  schema: { safeParse: (v: unknown) => { success: boolean; data?: T; error?: unknown } },
): Promise<T | Response> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return err('validation', 'invalid JSON body', 400);
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return err('validation', 'request body failed validation', 400);
  return parsed.data as T;
}

function paginate<T>(items: T[], url: URL) {
  const page = Math.max(1, Number(url.searchParams.get('page') ?? 1));
  const perPage = Math.min(200, Math.max(1, Number(url.searchParams.get('per_page') ?? 50)));
  return {
    items: items.slice((page - 1) * perPage, page * perPage),
    total: items.length,
    page,
    per_page: perPage,
  };
}

function filterLeads(url: URL): LeadDto[] {
  const tier = url.searchParams.get('tier');
  const state = url.searchParams.get('state');
  const campaignId = url.searchParams.get('campaign_id');
  const q = url.searchParams.get('q')?.toLowerCase();
  const suppressed = url.searchParams.get('suppressed');
  return db.leads.filter((lead) => {
    if (tier === 'untiered' && lead.tier !== null) return false;
    if (tier && tier !== 'untiered' && lead.tier !== tier) return false;
    if (state && lead.latest_enrollment?.current_state !== state) return false;
    if (campaignId && lead.latest_enrollment?.campaign_id !== Number(campaignId)) return false;
    if (suppressed !== null && lead.is_suppressed !== (suppressed === 'true')) return false;
    if (
      q &&
      ![lead.email, lead.first_name, lead.last_name, lead.company]
        .filter(Boolean)
        .some((v) => v!.toLowerCase().includes(q))
    )
      return false;
    return true;
  });
}

// naive spintax/merge scan for the mock validate-template endpoint
function scanTemplate(template: string) {
  const tokens: Array<Record<string, unknown>> = [];
  const errors: Array<{ message: string; offset: number }> = [];
  let variations = 1;
  const re = /\{\{([^}]*)\}\}/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(template)) !== null) {
    if (m.index > last) tokens.push({ kind: 'text', value: template.slice(last, m.index) });
    const inner = m[1] ?? '';
    if (inner.startsWith('RANDOM|')) {
      const options = inner.split('|').slice(1);
      if (options.length < 2) errors.push({ message: 'RANDOM needs ≥2 options', offset: m.index });
      variations *= Math.max(options.length, 1);
      tokens.push({ kind: 'random', options, offset: m.index });
    } else {
      const [field, ...fb] = inner.split('|');
      tokens.push({
        kind: 'tag',
        field: field ?? '',
        fallback: fb.length > 0 ? fb.join('|') : null,
        offset: m.index,
      });
    }
    last = m.index + m[0].length;
  }
  if (template.slice(last).includes('{{'))
    errors.push({ message: 'unclosed merge tag', offset: template.indexOf('{{', last) });
  if (last < template.length) tokens.push({ kind: 'text', value: template.slice(last) });
  return { tokens, errors, variations };
}

const mockChecks = { fatal: [], warnings: [], score: 10, variations: 4 };

/** Parse errors block the save the way B6.5 does: 422 sequence_invalid with the
 *  per step/variant/field errors the builder maps onto its tabs (docs/12 §5). */
function sequenceTemplateErrors(
  body: import('@coldemail/shared').SequenceWriteBody,
): Array<{ step_no: number; label: string; field: string; message: string }> {
  return body.steps.flatMap((step) =>
    step.variants.flatMap((variant) =>
      (
        [
          ['subject_template', variant.subject_template],
          ['body_template', variant.body_template],
        ] as const
      ).flatMap(([field, source]) =>
        scanTemplate(source).errors.map((error) => ({
          step_no: step.step_no,
          label: variant.label,
          field,
          message: error.message,
        })),
      ),
    ),
  );
}

const SPAM_PHRASES = ['free', 'act now', 'limited time', 'guarantee', 'risk free', 'click here'];

/** Mirrors the load-bearing half of docs/08 §5 so the builder's checklist behaves
 *  offline the way the real engine does — notably URLs are FATAL in step 1. */
function mockRenderChecks(
  stepNo: number,
  subject: string,
  body: string,
  compliance: { physical_address: string; optout_text: string },
) {
  const fatal: Array<{ id: string; message: string }> = [];
  const warnings: Array<{ id: string; message: string }> = [];
  const content = `${subject}\n${body}`;

  for (const source of [subject, body]) {
    for (const error of scanTemplate(source).errors) {
      fatal.push({ id: 'template_parse', message: `${error.message} (offset ${error.offset})` });
    }
  }
  if (/(https?:\/\/|www\.)/i.test(content)) {
    if (stepNo === 1) fatal.push({ id: 'url_in_step1', message: 'step 1 must not contain URLs' });
    else warnings.push({ id: 'url', message: 'follow-up contains a URL' });
  }
  if (compliance.physical_address.trim() === '' || compliance.optout_text.trim() === '') {
    fatal.push({
      id: 'footer',
      message: 'compliance footer needs a physical address and opt-out text',
    });
  }
  if (/<\/?[a-z][^>]*>/i.test(content)) {
    fatal.push({ id: 'html', message: 'HTML tags / image markup are not allowed' });
  }
  if (subject.length > 60) {
    warnings.push({
      id: 'subject_length',
      message: `subject may reach ${subject.length} chars (max 60)`,
    });
  }
  const words = body.split(/\s+/).filter((w) => w !== '').length;
  if (words < 40 || words > 180) {
    warnings.push({ id: 'body_length', message: `body is ${words} words (want 40–180)` });
  }
  const lower = content.toLowerCase();
  for (const phrase of SPAM_PHRASES) {
    if (lower.includes(phrase)) {
      warnings.push({ id: `spam:${phrase}`, message: `spam trigger: "${phrase}"` });
    }
  }
  const score = Math.max(0, Math.min(10, 10 - 2 * fatal.length - 0.4 * warnings.length));
  return { fatal, warnings, score: Math.round(score * 10) / 10 };
}

export const handlers: RequestHandler[] = [
  // ── auth ──────────────────────────────────────────────────────────────────
  http.post(`${BASE}/auth/login`, async ({ request }) => {
    const body = await parseBody(request, loginBodySchema);
    if (body instanceof Response) return body;
    if (body.password === 'wrong') return unauthorized(); // testable failure path
    db.authenticated = true;
    persistSession(true);
    return HttpResponse.json({ ok: true }); // contract: identity comes from /auth/me
  }),
  http.post(`${BASE}/auth/logout`, () => {
    db.authenticated = false;
    persistSession(false);
    return HttpResponse.json({ ok: true });
  }),
  http.get(`${BASE}/auth/me`, () => {
    if (!db.authenticated) return unauthorized();
    return HttpResponse.json({ email: db.operatorEmail });
  }),
  http.post(
    `${BASE}/auth/change-password`,
    authed(async ({ request }) => {
      const body = await parseBody(request, changePasswordBodySchema);
      if (body instanceof Response) return body;
      return HttpResponse.json({ ok: true });
    }),
  ),

  // ── mailboxes ─────────────────────────────────────────────────────────────
  http.get(
    `${BASE}/mailboxes`,
    authed(() => HttpResponse.json({ items: db.mailboxes })),
  ),
  http.get(
    `${BASE}/mailboxes/volume`,
    authed(() => HttpResponse.json(db.volume)),
  ),
  http.get(
    `${BASE}/mailboxes/:id/folders`,
    authed(({ params }) => {
      const mailbox = db.mailboxes.find((item) => item.id === Number(params.id));
      if (!mailbox) return notFound('mailbox');
      return HttpResponse.json({
        items: [
          { name: 'INBOX', special_use: '\\Inbox' },
          { name: '[Gmail]/Spam', special_use: '\\Junk' },
          { name: 'Sent', special_use: '\\Sent' },
        ],
      });
    }),
  ),
  http.post(
    `${BASE}/mailboxes`,
    authed(async ({ request }) => {
      const body = await parseBody(request, createMailboxBodySchema);
      if (body instanceof Response) return body;
      const mailbox = {
        id: db.nextId++,
        display_name: body.display_name,
        from_address: body.from_address,
        smtp_host: body.auth_type === 'google_oauth' ? 'smtp.gmail.com' : body.smtp_host!,
        smtp_port: body.smtp_port ?? 465,
        imap_host: body.auth_type === 'google_oauth' ? 'imap.gmail.com' : body.imap_host!,
        imap_port: body.imap_port ?? 993,
        daily_cap: body.daily_cap ?? 30,
        effective_cap: body.daily_cap ?? 30,
        send_window: body.send_window ?? { days: [1, 2, 3, 4, 5], start: '08:00', end: '17:00' },
        timezone: body.timezone ?? 'America/New_York',
        poll_folders:
          body.poll_folders ??
          (body.auth_type === 'google_oauth' ? ['INBOX', '[Gmail]/Spam'] : ['INBOX']),
        auth_type: body.auth_type ?? 'app_password',
        oauth_connected: false,
        status: (body.auth_type === 'google_oauth'
          ? 'setup_required'
          : 'ok') as MailboxDto['status'],
        status_reason: null,
        sent_today: 0,
        hard_bounce_pct: 0,
        seven_day_avg: 0,
        last_successful_poll_at: null as string | null,
      };
      db.mailboxes.push(mailbox);
      return HttpResponse.json(mailbox, { status: 201 });
    }),
  ),
  http.patch(
    `${BASE}/mailboxes/:id`,
    authed(async ({ request, params }) => {
      const mailbox = db.mailboxes.find((m) => m.id === Number(params.id));
      if (!mailbox) return notFound('mailbox');
      const body = await parseBody(request, patchMailboxBodySchema);
      if (body instanceof Response) return body;
      const { password: _pw, ...patch } = body;
      Object.assign(mailbox, patch);
      if (body.daily_cap !== undefined) mailbox.effective_cap = body.daily_cap;
      return HttpResponse.json(mailbox);
    }),
  ),
  http.post(
    `${BASE}/leads/:id/erase`,
    authed(async ({ request, params }) => {
      const index = db.leads.findIndex((lead) => lead.id === Number(params.id));
      if (index === -1) return notFound('lead');
      const body = await parseBody(request, eraseLeadBodySchema);
      if (body instanceof Response) return body;
      if (body.confirm !== db.leads[index]!.email)
        return err('validation', 'confirm must equal the current email', 400);
      db.leads.splice(index, 1);
      return HttpResponse.json({ ok: true });
    }),
  ),
  http.post(
    `${BASE}/mailboxes/:id/test-connection`,
    authed(({ params }) => {
      const mailbox = db.mailboxes.find((m) => m.id === Number(params.id));
      if (!mailbox) return notFound('mailbox');
      const failed = mailbox.status === 'auth_failed';
      return HttpResponse.json({
        smtp_ok: !failed,
        imap_ok: !failed,
        round_trip_ms: 142,
        folders: mailbox.poll_folders.map((name) => ({
          name,
          exists: true,
          special_use: name === 'INBOX' ? '\\Inbox' : name.includes('Spam') ? '\\Junk' : null,
        })),
      });
    }),
  ),
  http.post(
    `${BASE}/mailboxes/:id/oauth/google/start`,
    authed(({ params }) => {
      const mailbox = db.mailboxes.find((m) => m.id === Number(params.id));
      if (!mailbox) return notFound('mailbox');
      return HttpResponse.json({
        authorization_url: `https://accounts.google.com/o/oauth2/v2/auth?state=mock-${mailbox.id}`,
      });
    }),
  ),
  http.post(
    `${BASE}/mailboxes/:id/oauth/google/disconnect`,
    authed(({ params }) => {
      const mailbox = db.mailboxes.find((m) => m.id === Number(params.id));
      if (!mailbox) return notFound('mailbox');
      mailbox.oauth_connected = false;
      mailbox.status = 'setup_required';
      mailbox.status_reason = 'Google authorization disconnected';
      return HttpResponse.json({ ok: true });
    }),
  ),
  http.post(
    `${BASE}/mailboxes/:id/pause`,
    authed(({ params }) => {
      const mailbox = db.mailboxes.find((m) => m.id === Number(params.id));
      if (!mailbox) return notFound('mailbox');
      mailbox.status = 'paused';
      mailbox.status_reason = 'paused by operator';
      return HttpResponse.json({ ok: true });
    }),
  ),
  http.post(
    `${BASE}/mailboxes/:id/resume`,
    authed(async ({ request, params }) => {
      const mailbox = db.mailboxes.find((m) => m.id === Number(params.id));
      if (!mailbox) return notFound('mailbox');
      const body = await parseBody(request, resumeMailboxBodySchema);
      if (body instanceof Response) return body;
      const wasAutoPaused = mailbox.status === 'auto_paused';
      const capPct = body.cap_pct ?? (wasAutoPaused ? 50 : 100);
      mailbox.status = 'ok';
      mailbox.status_reason = null;
      mailbox.effective_cap = Math.round((mailbox.daily_cap * capPct) / 100);
      return HttpResponse.json({ ok: true });
    }),
  ),
  http.post(
    `${BASE}/mailboxes/:id/reconnect`,
    authed(async ({ request, params }) => {
      const mailbox = db.mailboxes.find((m) => m.id === Number(params.id));
      if (!mailbox) return notFound('mailbox');
      const body = await parseBody(request, reconnectMailboxBodySchema);
      if (body instanceof Response) return body;
      mailbox.status = 'ok';
      mailbox.status_reason = null;
      mailbox.last_successful_poll_at = NOW;
      return HttpResponse.json({ ok: true });
    }),
  ),

  // ── leads + suppression ───────────────────────────────────────────────────
  http.get(
    `${BASE}/leads`,
    authed(({ request }) => {
      const url = new URL(request.url);
      const filtered = filterLeads(url);
      return HttpResponse.json({
        ...paginate(filtered, url),
        untiered_count: db.leads.filter((l) => l.tier === null).length,
      });
    }),
  ),
  http.get(
    `${BASE}/leads/:id`,
    authed(({ params }) => {
      const lead = db.leads.find((l) => l.id === Number(params.id));
      if (!lead) return notFound('lead');
      const enrollment = lead.latest_enrollment;
      const campaign = enrollment
        ? db.campaigns.find((item) => item.id === enrollment.campaign_id)
        : undefined;
      const manualSendable =
        enrollment?.current_state === 'ACTIVE' && campaign?.status === 'active'
          ? [{ enrollment_id: lead.id, campaign_id: campaign.id, campaign_name: campaign.name }]
          : [];
      return HttpResponse.json({
        ...lead,
        notes: db.leadNotes.get(lead.id) ?? null,
        timeline: buildTimeline(lead),
        manual_sendable_enrollments: manualSendable,
      });
    }),
  ),
  http.patch(
    `${BASE}/leads/:id`,
    authed(async ({ request, params }) => {
      const lead = db.leads.find((l) => l.id === Number(params.id));
      if (!lead) return notFound('lead');
      const body = await parseBody(request, patchLeadBodySchema);
      if (body instanceof Response) return body;
      if (body.tier !== undefined) lead.tier = body.tier;
      if (body.custom_fields !== undefined) lead.custom_fields = body.custom_fields;
      if (body.notes !== undefined) db.leadNotes.set(lead.id, body.notes);
      return HttpResponse.json(lead);
    }),
  ),
  // Finding 10. Mirrors the refusal shape of the real ingest path so the
  // dialog's error rendering is exercised in mock mode too.
  http.post(
    `${BASE}/leads`,
    authed(async ({ request }) => {
      const body = await parseBody(request, createLeadBodySchema);
      if (body instanceof Response) return body;
      const email = body.email.trim().toLowerCase();
      const local = email.split('@')[0] ?? '';
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
        return HttpResponse.json({ created: false, reason: 'invalid' });
      if (db.leads.some((l) => l.email.toLowerCase() === email))
        return HttpResponse.json({ created: false, reason: 'duplicate' });
      if (['info', 'sales', 'support', 'admin', 'hello', 'contact'].includes(local))
        return HttpResponse.json({ created: false, reason: 'role_based' });
      db.leads.unshift({
        id: db.nextId++,
        email,
        first_name: body.first_name ?? null,
        last_name: body.last_name ?? null,
        company: body.company ?? null,
        city: body.city ?? null,
        state: body.state ?? null,
        tier: null, // decision R — imported leads start untiered
        is_suppressed: false,
        custom_fields: {},
      });
      return HttpResponse.json({ created: true });
    }),
  ),
  http.post(
    `${BASE}/leads/bulk-tier`,
    authed(async ({ request }) => {
      const body = await parseBody(request, bulkTierBodySchema);
      if (body instanceof Response) return body;
      let targets: LeadDto[] = [];
      if (body.lead_ids) {
        const ids = new Set(body.lead_ids);
        targets = db.leads.filter((l) => ids.has(l.id));
      } else if (body.filter) {
        const url = new URL('http://mock/leads');
        for (const [k, v] of Object.entries(body.filter)) {
          if (v !== undefined) url.searchParams.set(k, String(v));
        }
        targets = filterLeads(url);
      }
      for (const lead of targets) lead.tier = body.tier;
      return HttpResponse.json({ updated: targets.length });
    }),
  ),
  http.delete(
    `${BASE}/suppressions/:email`,
    authed(async ({ request, params }) => {
      const email = decodeURIComponent(params.email!);
      const body = await parseBody(request, deleteSuppressionBodySchema);
      if (body instanceof Response) return body;
      if (body.confirm !== email) return err('validation', 'confirm must equal the email', 400);
      const lead = db.leads.find((l) => l.email === email);
      if (!lead || !lead.is_suppressed) return notFound('suppression');
      lead.is_suppressed = false;
      return HttpResponse.json({ ok: true });
    }),
  ),

  // ── imports ───────────────────────────────────────────────────────────────
  http.post(
    `${BASE}/imports`,
    authed(async ({ request }) => {
      const form = await request.formData().catch(() => null);
      const file = form?.get('file');
      if (!(file instanceof File)) return err('validation', 'file field required', 400);
      const importRow = {
        id: db.nextId++,
        filename: file.name,
        rows_total: 1000,
        counts: {
          ok: 885,
          missing_first_name: 82,
          role_based: 60,
          invalid: 40,
          duplicate: 15,
          suppressed: 0,
        },
        committed: false,
        commit_mode: null,
        created_at: NOW,
      };
      db.imports.unshift(importRow);
      return HttpResponse.json({
        import_id: importRow.id,
        counts: importRow.counts,
        samples: {
          role_based: [{ row_no: 12, email: 'info@apexrealty.com' }],
          invalid: [{ row_no: 44, email: 'sarah.chen@@example' }],
          duplicate: [{ row_no: 81, email: 'mike.kim7@example.com' }],
          missing_first_name: [{ row_no: 102, email: 'jbrooks@dwell.com' }],
        },
        draft_counts: { new_leads: 885, existing_leads: 15, valid_drafts: 0, invalid_drafts: 0 },
      });
    }),
  ),
  http.post(
    `${BASE}/imports/:id/commit`,
    authed(async ({ request, params }) => {
      const importRow = db.imports.find((i) => i.id === Number(params.id));
      if (!importRow) return notFound('import');
      if (importRow.committed) return err('conflict', 'import already committed', 409);
      const body = await parseBody(request, commitImportBodySchema);
      if (body instanceof Response) return body;
      importRow.committed = true;
      importRow.commit_mode = body.mode;
      const imported = body.mode === 'drop_flagged' ? 885 : 945;
      return HttpResponse.json({
        imported,
        leads_created: imported,
        drafts_created: 0,
        drafts_replaced: 0,
        drafts_skipped: 0,
        invalid_drafts: 0,
      });
    }),
  ),
  http.get(
    `${BASE}/imports/:id/draft-preview`,
    authed(({ params }) => {
      if (!db.imports.some((item) => item.id === Number(params.id))) return notFound('import');
      return HttpResponse.json({
        new_leads: 885,
        existing_leads: 15,
        valid_drafts: 0,
        invalid_drafts: 0,
        existing_draft_conflicts: 0,
      });
    }),
  ),
  http.get(
    `${BASE}/imports`,
    authed(({ request }) => HttpResponse.json(paginate(db.imports, new URL(request.url)))),
  ),

  // ── sequences ─────────────────────────────────────────────────────────────
  http.get(
    `${BASE}/sequences`,
    authed(() => HttpResponse.json({ items: db.sequences })),
  ),
  http.post(
    `${BASE}/sequences`,
    authed(async ({ request }) => {
      const body = await parseBody(request, sequenceWriteBodySchema);
      if (body instanceof Response) return body;
      const templateErrors = sequenceTemplateErrors(body);
      if (templateErrors.length > 0)
        return err('sequence_invalid', 'template errors block the save', 422, {
          errors: templateErrors,
        });
      const sequence: SequenceDto = {
        id: db.nextId++,
        name: body.name,
        stop_on_reply: body.stop_on_reply,
        stop_on_hard_bounce: true,
        stop_on_unsubscribe: true,
        variable_defaults: body.variable_defaults,
        steps: body.steps.map((step) => ({
          id: db.nextId++,
          step_no: step.step_no,
          wait_days: step.wait_days,
          in_thread: step.in_thread,
          variants: step.variants.map((v) => ({
            id: db.nextId++,
            label: v.label,
            subject_template: v.subject_template,
            body_template: v.body_template,
            active: v.active,
          })),
        })),
      };
      db.sequences.push(sequence);
      return HttpResponse.json(sequence, { status: 201 });
    }),
  ),
  http.patch(
    `${BASE}/sequences/:id`,
    authed(async ({ request, params }) => {
      const index = db.sequences.findIndex((s) => s.id === Number(params.id));
      if (index === -1) return notFound('sequence');
      const body = await parseBody(request, sequenceWriteBodySchema);
      if (body instanceof Response) return body;
      const templateErrors = sequenceTemplateErrors(body);
      if (templateErrors.length > 0)
        return err('sequence_invalid', 'template errors block the save', 422, {
          errors: templateErrors,
        });
      const existing = db.sequences[index]!;
      const sequence: SequenceDto = {
        id: existing.id,
        name: body.name,
        stop_on_reply: body.stop_on_reply,
        stop_on_hard_bounce: true,
        stop_on_unsubscribe: true,
        variable_defaults: body.variable_defaults,
        steps: body.steps.map((step) => ({
          id: step.id ?? db.nextId++,
          step_no: step.step_no,
          wait_days: step.wait_days,
          in_thread: step.in_thread,
          variants: step.variants.map((v) => ({
            id: v.id ?? db.nextId++,
            label: v.label,
            subject_template: v.subject_template,
            body_template: v.body_template,
            active: v.active,
          })),
        })),
      };
      db.sequences[index] = sequence;
      return HttpResponse.json(sequence);
    }),
  ),
  http.post(
    `${BASE}/sequences/:id/preview`,
    authed(async ({ request, params }) => {
      const sequence = db.sequences.find((s) => s.id === Number(params.id));
      if (!sequence) return notFound('sequence');
      const body = await parseBody(request, previewBodySchema);
      if (body instanceof Response) return body;
      const lead = db.leads.find((l) => l.id === body.lead_id);
      if (!lead) return notFound('lead');
      const variant = sequence.steps
        .flatMap((s) => s.variants)
        .find((v) => v.id === body.variant_id);
      if (!variant) return notFound('variant');
      const first = lead.first_name ?? 'there';
      const expand = (template: string) =>
        template
          .replace(/\{\{RANDOM\|([^}]*)\}\}/g, (_m, options: string) => options.split('|')[0] ?? '')
          .replace(/\{\{first_name[^}]*\}\}/g, first)
          .replace(/\{\{company[^}]*\}\}/g, lead.company ?? 'your team')
          .replace(/\{\{[^}]*\}\}/g, lead.city ?? 'your market');
      const subject = expand(variant.subject_template);
      const bodyPreFooter = expand(variant.body_template);
      // The real engine appends the footer after all expansion (docs/08 §4) —
      // final blank line included so the panel can split it back out. Mirrors
      // render/footer.ts appendFooter, including the dormant-URL fallback.
      const base = db.compliance.unsubscribe_base_url.trim();
      const optoutLine =
        base === ''
          ? db.compliance.optout_text
          : `Unsubscribe: ${base}/u/preview-token or reply STOP`;
      const footer = `\n\n${optoutLine} | ${db.compliance.physical_address}`;
      return HttpResponse.json({
        subject,
        body: bodyPreFooter + footer,
        checks: {
          ...mockRenderChecks(body.step_no, subject, bodyPreFooter, db.compliance),
          variations:
            scanTemplate(variant.subject_template).variations *
            scanTemplate(variant.body_template).variations,
        },
      });
    }),
  ),
  http.delete(
    `${BASE}/sequences/:id`,
    authed(async ({ request, params }) => {
      const index = db.sequences.findIndex((sequence) => sequence.id === Number(params.id));
      if (index === -1) return notFound('sequence');
      const body = await parseBody(request, deleteSequenceBodySchema);
      if (body instanceof Response) return body;
      const sequence = db.sequences[index]!;
      if (body.confirm !== sequence.name)
        return err('validation', 'confirm must equal the sequence name', 400);
      if (db.campaigns.some((campaign) => campaign.sequence_id === sequence.id))
        return err('conflict', 'sequence has campaign references', 409);
      db.sequences.splice(index, 1);
      return HttpResponse.json({ ok: true });
    }),
  ),
  http.post(
    `${BASE}/sequences/validate-template`,
    authed(async ({ request }) => {
      const body = await parseBody(request, validateTemplateBodySchema);
      if (body instanceof Response) return body;
      return HttpResponse.json(scanTemplate(body.template));
    }),
  ),

  // ── campaigns ─────────────────────────────────────────────────────────────
  http.get(
    `${BASE}/campaigns`,
    authed(({ request }) => HttpResponse.json(paginate(db.campaigns, new URL(request.url)))),
  ),
  http.post(
    `${BASE}/campaigns`,
    authed(async ({ request }) => {
      const body = await parseBody(request, createCampaignBodySchema);
      if (body instanceof Response) return body;
      if (!db.sequences.some((s) => s.id === body.sequence_id)) return notFound('sequence');
      const campaign = {
        id: db.nextId++,
        name: body.name,
        status: 'draft' as const,
        sequence_id: body.sequence_id,
        tier_effort_config: body.tier_effort_config ?? {
          A: 'human_written' as const,
          B: 'template_researched' as const,
          C: 'template_auto' as const,
        },
        ramp_config: body.ramp_config ?? { ramp_days: 7, ramp_daily_enroll_cap: 20 },
        ramp_stages: body.ramp_stages ?? [
          { start_day: 1, end_day: 1, cap: 5 },
          { start_day: 2, end_day: 2, cap: 8 },
          { start_day: 3, end_day: 3, cap: 10 },
          { start_day: 4, end_day: 4, cap: 12 },
          { start_day: 5, end_day: 7, cap: 15 },
        ],
        first_activated_at: null,
        variable_overrides: body.variable_overrides ?? {},
        resolved_variables: {},
        auto_observation: body.auto_observation ?? { field: null, rules: {} },
        recycled_from_campaign_id: null,
        enrolled_count: 0,
        contacted_count: 0,
        manual_only_count: 0,
      };
      db.campaigns.push(campaign);
      return HttpResponse.json(campaign, { status: 201 });
    }),
  ),
  http.patch(
    `${BASE}/campaigns/:id`,
    authed(async ({ request, params }) => {
      const campaign = db.campaigns.find((c) => c.id === Number(params.id));
      if (!campaign) return notFound('campaign');
      const body = await parseBody(request, patchCampaignBodySchema);
      if (body instanceof Response) return body;
      Object.assign(campaign, body);
      if (body.status === 'active' && campaign.first_activated_at === null) {
        campaign.first_activated_at = NOW;
        const sequence = db.sequences.find((item) => item.id === campaign.sequence_id);
        campaign.resolved_variables = {
          ...(sequence?.variable_defaults ?? {}),
          ...campaign.variable_overrides,
        };
      }
      return HttpResponse.json(campaign);
    }),
  ),
  http.delete(
    `${BASE}/campaigns/:id`,
    authed(async ({ request, params }) => {
      const index = db.campaigns.findIndex((campaign) => campaign.id === Number(params.id));
      if (index === -1) return notFound('campaign');
      const body = await parseBody(request, deleteCampaignBodySchema);
      if (body instanceof Response) return body;
      const campaign = db.campaigns[index]!;
      if (body.confirm !== campaign.name)
        return err('validation', 'confirm must equal the campaign name', 400);
      if (campaign.enrolled_count > 0 || campaign.contacted_count > 0)
        return err('conflict', 'campaign has history', 409);
      db.campaigns.splice(index, 1);
      return HttpResponse.json({ ok: true });
    }),
  ),
  http.get(
    `${BASE}/campaigns/:id/capacity`,
    authed(({ params }) => {
      if (!db.campaigns.some((c) => c.id === Number(params.id))) return notFound('campaign');
      return HttpResponse.json(db.overview.capacity);
    }),
  ),
  http.post(
    `${BASE}/campaigns/:id/enroll`,
    authed(async ({ request, params }) => {
      const campaign = db.campaigns.find((c) => c.id === Number(params.id));
      if (!campaign) return notFound('campaign');
      const raw = (await request.json().catch(() => null)) as {
        count?: number;
        lead_ids?: number[];
      } | null;
      const count = raw?.count ?? raw?.lead_ids?.length ?? 0;
      if (count < 1) return err('validation', 'count or lead_ids required', 400);
      const room = db.overview.capacity.room_for_new;
      const rampRoom = db.overview.capacity.ramp_cap_remaining ?? room;
      const available = Math.min(room, rampRoom);
      if (count > available) {
        return err('capacity_exceeded', `only ${available} slots available today`, 409, {
          suggested: available,
        });
      }
      campaign.enrolled_count += count;
      db.overview.capacity.room_for_new -= count;
      db.overview.capacity.enrolled_today += count;
      if (db.overview.capacity.ramp_cap_remaining !== null) {
        db.overview.capacity.ramp_cap_remaining -= count;
      }
      db.overview.capacity.suggested = Math.min(
        db.overview.capacity.room_for_new,
        db.overview.capacity.ramp_cap_remaining ?? db.overview.capacity.room_for_new,
      );
      db.outcomes.NEW += count;
      db.outcomes.total += count;
      return HttpResponse.json({ enrolled: count, skipped: [] });
    }),
  ),
  http.get(
    `${BASE}/campaigns/:id/outcomes`,
    authed(({ params }) => {
      if (!db.campaigns.some((c) => c.id === Number(params.id))) return notFound('campaign');
      return HttpResponse.json(db.outcomes);
    }),
  ),
  http.post(
    `${BASE}/campaigns/:id/recycle`,
    authed(async ({ request, params }) => {
      const target = db.campaigns.find((c) => c.id === Number(params.id));
      if (!target) return notFound('campaign');
      const body = await parseBody(request, recycleBodySchema);
      if (body instanceof Response) return body;
      if (target.status !== 'draft')
        return err('conflict', 'recycle target must be a draft campaign', 409);
      // Decision Q: the cohort already received sequence 1's templates, so
      // recycling them into it would re-send identical content — the hash guard
      // blocks the WHOLE action and names the offending steps.
      if (target.sequence_id === 1) {
        return err(
          'recycle_sequence_conflict',
          'target sequence would re-send content these leads already received',
          409,
          { step_nos: [1, 2, 3, 4] },
        );
      }
      target.recycled_from_campaign_id = body.source_campaign_id;
      target.enrolled_count += 120;
      return HttpResponse.json({
        enrolled: 120,
        skipped: [{ reason: 'resting', count: 660 }],
      });
    }),
  ),
  http.get(
    `${BASE}/cold-storage`,
    authed(({ request }) => {
      const url = new URL(request.url);
      if (!url.searchParams.get('source_campaign_id'))
        return err('validation', 'source_campaign_id required', 400);
      const completed = db.leads.filter(
        (l) => l.latest_enrollment?.current_state === 'COMPLETED' && !l.is_suppressed,
      );
      return HttpResponse.json({
        ...paginate(completed, url),
        items: paginate(completed, url).items.map((lead, i) => ({
          lead: { id: lead.id, email: lead.email, tier: lead.tier },
          completed_at: '2026-02-20T15:00:00.000Z',
          earliest_recycle_at:
            i % 5 === 0 ? '2026-03-22T15:00:00.000Z' : '2026-02-01T15:00:00.000Z',
          eligible: i % 5 !== 0,
        })),
      });
    }),
  ),

  // ── unibox + enrollment actions + manual sends ────────────────────────────
  http.get(
    `${BASE}/unibox`,
    authed(({ request }) => {
      const url = new URL(request.url);
      const bucket = url.searchParams.get('bucket') ?? 'human';
      const sentiment = url.searchParams.get('sentiment');
      const unhandled = url.searchParams.get('unhandled');
      const items = db.unibox.filter((item) => {
        const isAuto = item.incoming_message_id >= 200;
        if (bucket === 'human' ? isAuto : !isAuto) return false;
        if (sentiment && item.effective_sentiment !== sentiment) return false;
        if (unhandled === 'true' && item.effective_sentiment !== null) return false;
        return true;
      });
      return HttpResponse.json(paginate(items, url));
    }),
  ),
  http.get(
    `${BASE}/unibox/:id`,
    authed(({ params }) => {
      const item = db.unibox.find((i) => i.incoming_message_id === Number(params.id));
      if (!item) return notFound('message');
      return HttpResponse.json({
        ...item,
        body_text: `${item.snippet}\n\n> On step ${item.step_no ?? 1} we wrote to ${item.lead.name}…`,
        thread: Array.from({ length: item.step_no ?? 1 }, (_, i) => ({
          message_id: `<ce-1-${item.enrollment_id}-${i + 1}@mock>`,
          step_no: i + 1,
          sent_at: `2026-01-${String(6 + i * 3).padStart(2, '0')}T15:00:00.000Z`,
        })),
      });
    }),
  ),
  http.get(
    `${BASE}/enrollments/:id/manual-compose-prefill`,
    authed(({ params }) => {
      const enrollmentId = Number(params.id);
      const lead = db.leads.find((item) => item.id === enrollmentId);
      const campaign = db.campaigns.find(
        (item) => item.id === lead?.latest_enrollment?.campaign_id,
      );
      if (!lead || !campaign) return notFound('enrollment');
      const stepNo = Math.max(1, lead.latest_enrollment?.current_step_no ?? 1);
      return HttpResponse.json({
        enrollment_id: enrollmentId,
        lead_id: lead.id,
        campaign: { id: campaign.id, name: campaign.name },
        step_no: stepNo,
        step_count: 4,
        due_at: NOW,
        personalization_mode: 'human_written',
        subject:
          stepNo > 1
            ? `Re: Quick question about ${lead.company}`
            : `Quick question about ${lead.company}`,
        body: `Hi ${lead.first_name ?? 'there'},\n\nThis is the due step starting point.`,
        variant_id: 1,
        draft_id: null,
        draft_status: null,
        draft_source_import_id: null,
        thread: {
          assigned_mailbox_id: stepNo > 1 ? 1 : null,
          previous_message_ids: stepNo > 1 ? ['<ce-mock-1@example.com>'] : [],
          in_thread: stepNo > 1,
        },
        checks: mockChecks,
      });
    }),
  ),
  http.get(
    `${BASE}/reminders`,
    authed(({ request }) => {
      const url = new URL(request.url);
      const status = url.searchParams.get('status') ?? 'open';
      const items = db.reminders.filter((reminder) => reminder.status === status);
      return HttpResponse.json({
        ...paginate(items, url),
        open_count: db.reminders.filter((reminder) => reminder.status === 'open').length,
      });
    }),
  ),
  http.post(
    `${BASE}/unibox/:id/reminders`,
    authed(async ({ request, params }) => {
      const item = db.unibox.find(
        (candidate) => candidate.incoming_message_id === Number(params.id),
      );
      if (!item) return notFound('message');
      const body = await parseBody(request, createReminderBodySchema);
      if (body instanceof Response) return body;
      db.reminders.push({
        id: db.nextId++,
        enrollment_id: item.enrollment_id,
        incoming_message_id: item.incoming_message_id,
        due_date: body.due_date,
        note: body.note ?? null,
        source: 'manual',
        status: 'open',
        created_at: NOW,
        completed_at: null,
        lead: item.lead,
        campaign_id: item.campaign_id,
        reply_snippet: item.snippet,
      });
      return HttpResponse.json({ ok: true });
    }),
  ),
  http.patch(
    `${BASE}/reminders/:id`,
    authed(async ({ request, params }) => {
      const reminder = db.reminders.find((item) => item.id === Number(params.id));
      if (!reminder) return notFound('reminder');
      const body = await parseBody(request, patchReminderBodySchema);
      if (body instanceof Response) return body;
      if (body.due_date !== undefined) reminder.due_date = body.due_date;
      if (body.note !== undefined) reminder.note = body.note ?? null;
      if (body.status !== undefined) {
        reminder.status = body.status;
        reminder.completed_at = body.status === 'done' ? NOW : null;
      }
      return HttpResponse.json({ ok: true });
    }),
  ),
  http.post(
    `${BASE}/unibox/:id/disposition`,
    authed(async ({ request, params }) => {
      const item = db.unibox.find(
        (candidate) => candidate.incoming_message_id === Number(params.id),
      );
      if (!item) return notFound('message');
      const body = await parseBody(request, dispositionReplyBodySchema);
      if (body instanceof Response) return body;

      item.disposition = body.disposition;
      item.recontact_after = body.recontact_after ?? null;
      if (body.disposition === 'not_now' && body.recontact_after) {
        const existing = db.reminders.find(
          (reminder) =>
            reminder.incoming_message_id === item.incoming_message_id &&
            reminder.source === 'not_now',
        );
        if (existing) {
          existing.due_date = body.recontact_after;
          existing.status = 'open';
          existing.completed_at = null;
        } else {
          db.reminders.push({
            id: db.nextId++,
            enrollment_id: item.enrollment_id,
            incoming_message_id: item.incoming_message_id,
            due_date: body.recontact_after,
            note: "Follow up after this lead's requested date.",
            source: 'not_now',
            status: 'open',
            created_at: NOW,
            completed_at: null,
            lead: item.lead,
            campaign_id: item.campaign_id,
            reply_snippet: item.snippet,
          });
        }
      } else {
        for (const reminder of db.reminders) {
          if (
            reminder.incoming_message_id === item.incoming_message_id &&
            reminder.source === 'not_now' &&
            reminder.status === 'open'
          ) {
            reminder.status = 'dismissed';
          }
        }
      }
      return HttpResponse.json(item);
    }),
  ),
  http.post(
    `${BASE}/unibox/:id/sentiment`,
    authed(async ({ request, params }) => {
      const item = db.unibox.find((i) => i.incoming_message_id === Number(params.id));
      if (!item) return notFound('message');
      const body = await parseBody(request, tagSentimentBodySchema);
      if (body instanceof Response) return body;
      const was = item.effective_sentiment;
      item.effective_sentiment = body.sentiment;
      item.suggested_sentiment = null;
      // tagging moves the positive rate + outcomes split (docs/11 §4)
      const delta = (body.sentiment === 'positive' ? 1 : 0) - (was === 'positive' ? 1 : 0);
      if (delta !== 0) {
        db.overview.positive_rate.numerator += delta;
        db.overview.positive_rate.value =
          Math.round(
            (db.overview.positive_rate.numerator / (db.overview.positive_rate.denominator ?? 1)) *
              1000,
          ) / 10;
        db.outcomes.REPLIED.positive += delta;
        db.outcomes.REPLIED.neutral -= delta;
        // The real event log attributes the positive to the step it landed on,
        // so the per-step breakdown moves WITH the campaign total — keep the
        // reconciliation footer honest by propagating the same delta here.
        const step = db.steps.find((s) => s.step_no === item.step_no);
        if (step) {
          step.positive_replies += delta;
          step.positive_rate.numerator += delta;
          step.positive_rate.value =
            Math.round(
              (step.positive_rate.numerator / (step.positive_rate.denominator || 1)) * 1000,
            ) / 10;
        }
      }
      return HttpResponse.json({ ok: true });
    }),
  ),
  http.post(
    `${BASE}/enrollments/:id/meeting-booked`,
    authed(({ params }) => {
      const item = db.unibox.find((i) => i.enrollment_id === Number(params.id));
      if (item) item.meeting_booked = true;
      db.overview.meetings.count += 1;
      db.overview.meetings.per_100 =
        Math.round(
          (db.overview.meetings.count / (db.overview.positive_rate.denominator ?? 1)) * 100 * 10,
        ) / 10;
      return HttpResponse.json({ ok: true });
    }),
  ),
  http.post(
    `${BASE}/enrollments/:id/snooze`,
    authed(async ({ request }) => {
      const body = await parseBody(request, snoozeBodySchema);
      if (body instanceof Response) return body;
      return HttpResponse.json({ ok: true });
    }),
  ),
  http.post(
    `${BASE}/enrollments/:id/unsubscribe`,
    authed(({ params }) => {
      const enrollmentId = Number(params.id);
      const lead = db.leads.find((l) => l.id === enrollmentId);
      if (lead) {
        lead.is_suppressed = true;
        if (lead.latest_enrollment) lead.latest_enrollment.current_state = 'UNSUBSCRIBED';
      }
      const item = db.unibox.find((i) => i.enrollment_id === enrollmentId);
      if (item) item.auto_unsubscribed = false; // manual, not auto — caption differs
      db.outcomes.UNSUBSCRIBED += 1;
      db.outcomes.COMPLETED -= 1;
      return HttpResponse.json({ ok: true });
    }),
  ),
  http.post(
    `${BASE}/manual-sends`,
    authed(async ({ request }) => {
      const body = await parseBody(request, manualSendBodySchema);
      if (body instanceof Response) return body;
      const lead = db.leads.find((l) => l.id === body.lead_id);
      if (!lead) return notFound('lead');
      if (lead.is_suppressed) return err('conflict', 'lead is suppressed', 409);
      return HttpResponse.json({
        enrollment_id: lead.id,
        message_id: `<ce-manual-${lead.id}-${db.nextId++}@mock>`,
        checks: mockChecks,
      });
    }),
  ),

  // ── analytics ─────────────────────────────────────────────────────────────
  http.get(
    `${BASE}/analytics/overview`,
    authed(({ request }) => {
      const url = new URL(request.url);
      if (!url.searchParams.get('campaign_id'))
        return err('validation', 'campaign_id required', 400);
      return HttpResponse.json(db.overview);
    }),
  ),
  http.get(
    `${BASE}/analytics/variants`,
    authed(() =>
      HttpResponse.json({
        items: [
          {
            variant_id: 1,
            label: 'A',
            subject_template: 'Quick question about {{company}}',
            deactivatable: true,
            sent: 443,
            reply_rate: { numerator: 40, denominator: 434, value: 9.2 },
            positive_rate: { numerator: 16, denominator: 434, value: 3.7 },
            meetings: 10,
          },
          {
            variant_id: 2,
            label: 'B',
            subject_template: '{{first_name|Hi}} — idea for {{company}}',
            deactivatable: true,
            sent: 442,
            reply_rate: { numerator: 32, denominator: 433, value: 7.4 },
            positive_rate: { numerator: 12, denominator: 433, value: 2.8 },
            meetings: 7,
          },
        ],
      }),
    ),
  ),
  http.get(
    `${BASE}/analytics/steps`,
    authed(({ request }) => {
      const url = new URL(request.url);
      if (!url.searchParams.get('sequence_id') && !url.searchParams.get('campaign_id'))
        return err('validation', 'sequence_id or campaign_id required', 400);
      return HttpResponse.json({ items: db.steps });
    }),
  ),
  http.get(
    `${BASE}/analytics/tiers`,
    authed(({ request }) => {
      const url = new URL(request.url);
      if (!url.searchParams.get('campaign_id'))
        return err('validation', 'campaign_id required', 400);
      return HttpResponse.json({ items: db.tiers, promotable: { tier_c_engaged: 8 } });
    }),
  ),
  http.get(
    `${BASE}/analytics/health-trend`,
    authed(() => {
      const totals = db.health.reduce(
        (acc, row) => ({
          sent: acc.sent + row.sent,
          delivered: acc.delivered + row.delivered,
          replies: acc.replies + row.replies,
          hard_bounces: acc.hard_bounces + row.hard_bounces,
          unsubscribes: acc.unsubscribes + row.unsubscribes,
        }),
        { sent: 0, delivered: 0, replies: 0, hard_bounces: 0, unsubscribes: 0 },
      );
      return HttpResponse.json({ items: db.health, totals, watch_flags: [] });
    }),
  ),
  http.post(
    `${BASE}/step-variants/:id/deactivate`,
    authed(({ params }) => {
      const variant = db.sequences
        .flatMap((s) => s.steps)
        .flatMap((s) => s.variants)
        .find((v) => v.id === Number(params.id));
      if (!variant) return notFound('variant');
      variant.active = false;
      return HttpResponse.json({ ok: true });
    }),
  ),

  // ── settings + compliance + alerts ────────────────────────────────────────
  http.get(
    `${BASE}/settings`,
    authed(() => HttpResponse.json(db.settings)),
  ),
  http.put(
    `${BASE}/settings`,
    authed(async ({ request }) => {
      const body = await parseBody(request, putSettingsBodySchema);
      if (body instanceof Response) return body;
      // PUT omits legacy read-only stop fields; responses retain them.
      db.settings = { ...db.settings, ...body, updated_at: NOW };
      return HttpResponse.json(db.settings);
    }),
  ),
  http.get(
    `${BASE}/compliance`,
    authed(() => HttpResponse.json(db.compliance)),
  ),
  http.put(
    `${BASE}/compliance`,
    authed(async ({ request }) => {
      const body = await parseBody(request, complianceSchema);
      if (body instanceof Response) return body;
      if (body.physical_address.trim() === '')
        return err('validation', 'physical_address must not be empty', 422);
      db.compliance = body;
      return HttpResponse.json(db.compliance);
    }),
  ),
  http.get(
    `${BASE}/alerts`,
    authed(({ request }) => {
      const url = new URL(request.url);
      const unacked = url.searchParams.get('unacked') === 'true';
      const items = db.alerts
        .filter((a) => (unacked ? a.acknowledged_at === null : true))
        .sort((a, b) => b.id - a.id);
      return HttpResponse.json(paginate(items, url));
    }),
  ),
  http.post(
    `${BASE}/alerts/:id/ack`,
    authed(({ params }) => {
      const alert = db.alerts.find((a) => a.id === Number(params.id));
      if (!alert) return notFound('alert');
      alert.acknowledged_at = NOW;
      return HttpResponse.json({ ok: true });
    }),
  ),

  // ── system ────────────────────────────────────────────────────────────────
  // Preflight against the mock's own state: no domains are configured in the
  // fixture, so it reports the honest not-launch-ready shape an operator sees
  // before buying anything.
  http.get(
    `${BASE}/system/preflight`,
    authed(() =>
      HttpResponse.json({
        ready: false,
        checks: [
          {
            id: 'compliance_address',
            label: 'Compliance postal address',
            status: 'pass',
            detail: 'Set. It is published in every email, so confirm it is not a home address.',
          },
          {
            id: 'unsubscribe_endpoint',
            label: 'Unsubscribe endpoint',
            status: db.compliance.unsubscribe_base_url.trim() === '' ? 'warn' : 'pass',
            detail:
              db.compliance.unsubscribe_base_url.trim() === ''
                ? 'Not configured — opt-out is reply-STOP only. Legal, but weak at volume.'
                : 'Configured. Gmail one-click is only proven once a real recipient uses it.',
          },
          {
            id: 'mailbox_health',
            label: 'Mailbox health',
            status: db.mailboxes.every((m) => m.status === 'ok') ? 'pass' : 'fail',
            detail: `${db.mailboxes.length} mailbox(es) configured.`,
          },
          {
            id: 'staged_enrollment',
            label: 'Staged enrollment enforced',
            status: 'warn',
            detail: 'min_ramp_days is 0. Set it before a real launch.',
          },
          {
            id: 'spf:agency.dev',
            label: 'SPF — agency.dev',
            status: 'fail',
            detail: 'No v=spf1 TXT record.',
          },
          {
            id: 'dkim:agency.dev',
            label: 'DKIM — agency.dev',
            status: 'unknown',
            detail: 'No key found at any common selector — this is not proof DKIM is missing.',
          },
        ],
      }),
    ),
  ),
  http.get(
    `${BASE}/system/status`,
    authed(() =>
      HttpResponse.json({
        scheduler_last_tick_at: NOW,
        send_blockers: [],
        transport_mode: 'mock',
        pollers: db.mailboxes.map((m) => ({
          mailbox_id: m.id,
          mailbox_address: m.from_address,
          last_successful_poll_at: m.last_successful_poll_at,
        })),
        pending_jobs: 0,
      }),
    ),
  ),
  http.post(
    `${BASE}/system/rebuild-projections`,
    authed(async ({ request }) => {
      const body = await parseBody(request, rebuildBodySchema);
      if (body instanceof Response) return body;
      return HttpResponse.json({ diffs: 0 });
    }),
  ),
  http.get(
    `${BASE}/incoming-messages`,
    authed(({ request }) => {
      const url = new URL(request.url);
      const classification = url.searchParams.get('classification');
      const rows = [
        ...db.unibox.map((item: UniboxItemDto, i) => ({
          id: item.incoming_message_id,
          mailbox_id: 1 + (i % 4),
          from_address: `reply-${item.lead.id}@example.com`,
          subject: `Re: Quick question about ${item.lead.company ?? 'your listings'}`,
          classification:
            item.incoming_message_id >= 200 ? ('auto_reply' as const) : ('human_reply' as const),
          dsn_status: null as string | null,
          matched_enrollment_id: item.enrollment_id,
          matched_lead_id: item.lead.id,
          resulting_event_ids: [item.incoming_message_id * 10],
          processed_at: item.received_at ?? NOW,
        })),
        // The other two classifier buckets (docs/07 §4) so the debug view is
        // complete: a hard bounce with a DSN, and an unmatched stray.
        {
          id: 900,
          mailbox_id: 2,
          from_address: 'MAILER-DAEMON@example.com',
          subject: 'Delivery Status Notification (Failure)',
          classification: 'bounce' as const,
          dsn_status: '5.1.1',
          matched_enrollment_id: 105,
          matched_lead_id: 105,
          resulting_event_ids: [9001],
          processed_at: NOW,
        },
        {
          id: 901,
          mailbox_id: 3,
          from_address: 'newsletter@unrelated.example',
          subject: 'Your weekly digest',
          classification: 'unrelated' as const,
          dsn_status: null,
          matched_enrollment_id: null,
          matched_lead_id: null,
          resulting_event_ids: [],
          processed_at: NOW,
        },
      ];
      const filtered = classification
        ? rows.filter((r) => r.classification === classification)
        : rows;
      return HttpResponse.json(paginate(filtered, url));
    }),
  ),
];
