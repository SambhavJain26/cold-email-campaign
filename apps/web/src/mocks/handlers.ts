// F0.4 — MSW handlers for EVERY endpoint in the docs/10 manifest, served from
// the in-memory golden-fixture state (db.ts). Mutations mutate that state so
// flows work end-to-end offline: enroll decrements capacity, tagging moves the
// positive rate, etc. Request bodies are parsed with the SHARED zod schemas —
// same validation the real server runs (decision H).
import { http, HttpResponse, type RequestHandler } from 'msw';
import {
  bulkTierBodySchema,
  bulkOutreachStatusBodySchema,
  createLeadBodySchema,
  changePasswordBodySchema,
  commitImportBodySchema,
  importAllocationPreviewBodySchema,
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
  personalizedCopyWriteBodySchema,
  patchCampaignBodySchema,
  patchAutoEnrollmentBodySchema,
  poolAddBodySchema,
  poolLeadIdsBodySchema,
  poolReassignBodySchema,
  patchLeadBodySchema,
  patchMailboxBodySchema,
  patchReminderBodySchema,
  previewBodySchema,
  putSettingsBodySchema,
  rebuildBodySchema,
  reconnectMailboxBodySchema,
  recycleBodySchema,
  recyclePreviewBodySchema,
  resumeMailboxBodySchema,
  sequenceWriteBodySchema,
  snoozeBodySchema,
  tagSentimentBodySchema,
  validateTemplateBodySchema,
  type ApiErrorCode,
  type CampaignPersonalizedCopyDto,
  type LeadDto,
  type MailboxDto,
  type SequenceDto,
  type UniboxItemDto,
} from '@coldemail/shared';
import { buildTimeline, db, persistSession, NOW } from './db';
import { incomingReviewHandlers } from './incoming-review';
import { sequenceScheduleHandlers, mockSequenceHasScheduleHistory } from './sequence-schedule';

const importCopySummaries = new Map<number, { genericValid: number; stepSpecificValid: number }>();

const BASE = '/api/v1';
const mockPersonalizedSources = new Map<
  string,
  {
    id: number;
    lead_id: number;
    slot_no: number;
    target_step_no: null;
    subject: string;
    body: string;
    status: 'needs_review' | 'ready';
    source_import_id: null;
    content_hash: string;
    created_at: string;
    updated_at: string;
  }
>();
const mockCampaignPersonalizedCopies = new Map<string, CampaignPersonalizedCopyDto>();

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
  const campaignScope = url.searchParams.get('campaign_scope') ?? 'enrolled';
  const poolCampaignId = url.searchParams.get('pool_campaign_id');
  const q = url.searchParams.get('q')?.toLowerCase();
  const suppressed = url.searchParams.get('suppressed');
  const outreachStatus = url.searchParams.get('outreach_status');
  return db.leads.filter((lead) => {
    if (tier === 'untiered' && lead.tier !== null) return false;
    if (tier && tier !== 'untiered' && lead.tier !== tier) return false;
    if (state && lead.latest_enrollment?.current_state !== state) return false;
    if (campaignId) {
      const id = Number(campaignId);
      const enrolled = lead.latest_enrollment?.campaign_id === id;
      const pooled =
        lead.pool_assignment?.campaign_id === id && lead.pool_assignment.status === 'available';
      if (
        campaignScope === 'pool'
          ? !pooled
          : campaignScope === 'both'
            ? !enrolled && !pooled
            : !enrolled
      )
        return false;
    }
    if (poolCampaignId && lead.pool_assignment?.campaign_id !== Number(poolCampaignId))
      return false;
    if (suppressed !== null && lead.is_suppressed !== (suppressed === 'true')) return false;
    if (outreachStatus && lead.outreach_status !== outreachStatus) return false;
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
  compliance: { physical_address: string; optout_text: string; include_postal_address?: boolean },
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
  if (compliance.include_postal_address !== false && compliance.physical_address.trim() === '') {
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
  ...sequenceScheduleHandlers,
  ...incomingReviewHandlers,
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
        send_interval_minutes: body.send_interval_minutes ?? null,
        send_interval_min_minutes: body.send_interval_min_minutes ?? 4,
        send_interval_max_minutes: body.send_interval_max_minutes ?? 7,
        next_allowed_send_at: null,
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
      return HttpResponse.json(mailbox);
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
      const capPct = body.cap_pct ?? (wasAutoPaused ? Number(db.settings.resume_cap_pct) : 100);
      mailbox.status = 'ok';
      mailbox.status_reason = null;
      mailbox.effective_cap = Math.max(1, Math.floor((mailbox.daily_cap * capPct) / 100));
      return HttpResponse.json(mailbox);
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
      return HttpResponse.json(mailbox);
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
        untiered_count: filtered.filter(
          (lead) => lead.tier === null && lead.outreach_status === 'standard',
        ).length,
        tier_counts: {
          A: filtered.filter((lead) => lead.tier === 'A').length,
          B: filtered.filter((lead) => lead.tier === 'B').length,
          untiered: filtered.filter(
            (lead) => lead.tier === null && lead.outreach_status === 'standard',
          ).length,
          nurture: filtered.filter((lead) => lead.outreach_status === 'nurture').length,
        },
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
  http.get(
    `${BASE}/leads/:id/personalized-copies`,
    authed(({ params }) => {
      const leadId = Number(params.id);
      if (!db.leads.some((lead) => lead.id === leadId)) return notFound('lead');
      return HttpResponse.json({
        sources: [...mockPersonalizedSources.values()].filter(
          (source) => source.lead_id === leadId,
        ),
        campaign_copies: [...mockCampaignPersonalizedCopies.values()].filter(
          (copy) => copy.lead_id === leadId,
        ),
      });
    }),
  ),
  http.put(
    `${BASE}/leads/:id/personalized-copy-sources/:slot`,
    authed(async ({ request, params }) => {
      const leadId = Number(params.id);
      const slotNo = Number(params.slot);
      if (!db.leads.some((lead) => lead.id === leadId)) return notFound('lead');
      const body = await parseBody(request, personalizedCopyWriteBodySchema);
      if (body instanceof Response) return body;
      if (body.action === 'copy_from_source') {
        return err('validation', 'an unassigned source cannot copy from itself', 400);
      }
      const key = `${leadId}:${slotNo}`;
      const existing = mockPersonalizedSources.get(key);
      const source = {
        id: existing?.id ?? leadId * 1000 + slotNo,
        lead_id: leadId,
        slot_no: slotNo,
        target_step_no: null,
        subject: body.subject ?? '',
        body: body.body ?? '',
        status: body.action === 'mark_ready' ? ('ready' as const) : ('needs_review' as const),
        source_import_id: null,
        content_hash: `mock-${leadId}-${slotNo}-${(body.subject ?? '').length}-${(body.body ?? '').length}`,
        created_at: existing?.created_at ?? NOW,
        updated_at: NOW,
      };
      mockPersonalizedSources.set(key, source);
      return HttpResponse.json({ result: existing ? 'replaced' : 'created', source });
    }),
  ),
  http.put(
    `${BASE}/leads/:id/campaigns/:campaignId/steps/:stepNo/personalized-copy`,
    authed(async ({ request, params }) => {
      const leadId = Number(params.id);
      const campaignId = Number(params.campaignId);
      const stepNo = Number(params.stepNo);
      if (!db.leads.some((lead) => lead.id === leadId)) return notFound('lead');
      const campaign = db.campaigns.find((item) => item.id === campaignId);
      const sequence = db.sequences.find((item) => item.id === campaign?.sequence_id);
      const step = sequence?.steps.find((item) => item.step_no === stepNo);
      if (!campaign || !sequence) return notFound('campaign sequence');
      if (!step) return notFound('sequence step');
      if (step.content_source !== 'personalized') {
        return err('conflict', 'the selected sequence step uses template content', 409);
      }
      const body = await parseBody(request, personalizedCopyWriteBodySchema);
      if (body instanceof Response) return body;
      const key = `${leadId}:${campaignId}:${stepNo}`;
      const existing = mockCampaignPersonalizedCopies.get(key);
      if (existing?.status === 'sent') {
        return err('conflict', 'sent personalized copy is immutable', 409);
      }
      const source =
        body.action === 'copy_from_source'
          ? mockPersonalizedSources.get(`${leadId}:${body.source_slot_no}`)
          : undefined;
      if (body.action === 'copy_from_source' && !source) {
        return notFound('personalized copy source');
      }
      const subject = source?.subject ?? body.subject ?? '';
      const copyBody = source?.body ?? body.body ?? '';
      const status =
        body.action === 'mark_ready' ||
        (body.action === 'copy_from_source' && source?.status === 'ready')
          ? ('ready' as const)
          : ('needs_review' as const);
      if (status === 'ready' && (!subject.trim() || !copyBody.trim())) {
        return err('validation', 'subject and body are required before marking ready', 422);
      }
      const copy: CampaignPersonalizedCopyDto = {
        id: existing?.id ?? leadId * 10_000 + campaignId * 100 + stepNo,
        lead_id: leadId,
        campaign_id: campaignId,
        campaign_name: campaign.name,
        sequence_step_id: step.id,
        step_no: stepNo,
        subject,
        body: copyBody,
        status,
        source_copy_id: source?.id ?? existing?.source_copy_id ?? null,
        source_import_id: source?.source_import_id ?? existing?.source_import_id ?? null,
        content_hash: `mock-${leadId}-${campaignId}-${stepNo}-${subject.length}-${copyBody.length}`,
        sent_event_id: null,
        sent_message_id: null,
        sent_subject: null,
        created_at: existing?.created_at ?? NOW,
        updated_at: NOW,
        sent_at: null,
      };
      mockCampaignPersonalizedCopies.set(key, copy);
      return HttpResponse.json({ result: existing ? 'replaced' : 'created', copy });
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
        outreach_status: 'standard',
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
  http.post(
    `${BASE}/leads/bulk-outreach-status`,
    authed(async ({ request }) => {
      const body = await parseBody(request, bulkOutreachStatusBodySchema);
      if (body instanceof Response) return body;
      let targets: LeadDto[] = [];
      if (body.lead_ids) {
        const ids = new Set(body.lead_ids);
        targets = db.leads.filter((lead) => ids.has(lead.id));
      } else if (body.filter) {
        const url = new URL('http://mock/leads');
        for (const [key, value] of Object.entries(body.filter)) {
          if (value !== undefined) url.searchParams.set(key, String(value));
        }
        targets = filterLeads(url);
      }
      for (const lead of targets) {
        lead.outreach_status = body.outreach_status;
        lead.tier = null;
      }
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
      const csvText = await file.text();
      const [header = '', ...csvRows] = csvText.split(/\r?\n/).filter((line) => line.trim() !== '');
      const headers = header.split(',').map((value) => value.trim().toLowerCase());
      const csvLeadCount = csvRows.length;
      const hasGeneric = headers.includes('manual_subject') && headers.includes('manual_body');
      const stepSubjects = headers.flatMap((value) => {
        const match = /^step_(\d+)_subject$/.exec(value);
        return match ? [Number(match[1])] : [];
      });
      const stepPairCount = stepSubjects.filter((stepNo) =>
        headers.includes(`step_${stepNo}_body`),
      ).length;
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
        pool_allocations: [],
        created_at: NOW,
      };
      importCopySummaries.set(importRow.id, {
        genericValid: hasGeneric ? csvLeadCount : 0,
        stepSpecificValid: stepPairCount * csvLeadCount,
      });
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
        draft_counts: {
          new_leads: 885,
          existing_leads: 15,
          valid_drafts: (hasGeneric ? csvLeadCount : 0) + stepPairCount * csvLeadCount,
          invalid_drafts: 0,
        },
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
      let allocationsCreated = 0;
      for (const allocation of body.allocations) {
        const campaign = db.campaigns.find((item) => item.id === allocation.campaign_id);
        if (!campaign) return notFound('campaign');
        const candidates = db.leads.filter(
          (lead) =>
            !lead.is_suppressed &&
            lead.outreach_status !== 'nurture' &&
            !db.campaignPools.some(
              (pool) => pool.lead.id === lead.id && pool.status === 'available',
            ),
        );
        if (candidates.length < allocation.count) {
          return err('conflict', 'allocation changed; refresh the preview', 409);
        }
        for (const lead of candidates.slice(0, allocation.count)) {
          db.campaignPools.push({
            id: db.nextId++,
            campaign_id: campaign.id,
            lead: {
              id: lead.id,
              email: lead.email,
              first_name: lead.first_name,
              last_name: lead.last_name,
              company: lead.company,
              tier: lead.tier,
            },
            source_import_id: importRow.id,
            allocation_order: db.nextId++,
            status: 'available',
            enrollment_id: null,
            last_eligibility_reason: null,
            allocated_at: NOW,
            enrolled_at: null,
            released_at: null,
          });
          lead.pool_assignment = {
            campaign_id: campaign.id,
            campaign_name: campaign.name,
            status: 'available',
          };
        }
        allocationsCreated += allocation.count;
        campaign.lead_selection_mode = 'pool';
        campaign.pool_summary.total += allocation.count;
        campaign.pool_summary.available += allocation.count;
        campaign.pool_summary.source_imports += 1;
        importRow.pool_allocations.push({
          campaign_id: campaign.id,
          campaign_name: campaign.name,
          total: allocation.count,
          available: allocation.count,
          enrolled: 0,
          released: 0,
        });
      }
      return HttpResponse.json({
        imported,
        leads_created: imported,
        drafts_created: 0,
        drafts_replaced: 0,
        drafts_skipped: 0,
        invalid_drafts: 0,
        allocations_created: allocationsCreated,
        remaining_global: Math.max(0, imported - allocationsCreated),
        sources_created: 0,
        sources_replaced: 0,
        sources_skipped: 0,
        copies_bound: 0,
        copies_unassigned: 0,
        copy_conflicts: 0,
      });
    }),
  ),
  http.delete(
    `${BASE}/imports/:id`,
    authed(({ params }) => {
      const index = db.imports.findIndex((item) => item.id === Number(params.id));
      if (index === -1) return notFound('import');
      if (db.imports[index]!.committed) {
        return err('conflict', 'Committed import history cannot be discarded', 409);
      }
      db.imports.splice(index, 1);
      importCopySummaries.delete(Number(params.id));
      return HttpResponse.json({ ok: true });
    }),
  ),
  http.post(
    `${BASE}/imports/:id/allocation-preview`,
    authed(async ({ request, params }) => {
      if (!db.imports.some((item) => item.id === Number(params.id))) return notFound('import');
      const body = await parseBody(request, importAllocationPreviewBodySchema);
      if (body instanceof Response) return body;
      const total = body.mode === 'drop_flagged' ? 885 : 945;
      const requested = body.allocations.reduce((sum, allocation) => sum + allocation.count, 0);
      const copySummary = importCopySummaries.get(Number(params.id)) ?? {
        genericValid: 0,
        stepSpecificValid: 0,
      };
      let genericRemaining = copySummary.genericValid;
      let stepSpecificRemaining = copySummary.stepSpecificValid;
      return HttpResponse.json({
        available: total,
        existing_leads: 15,
        remaining_global: Math.max(0, total - requested),
        exclusions: {},
        campaigns: body.allocations.map((allocation) => {
          const campaign = db.campaigns.find((item) => item.id === allocation.campaign_id);
          const sequence = db.sequences.find((item) => item.id === campaign?.sequence_id);
          const personalizedSteps =
            sequence?.steps
              .filter((step) => step.content_source === 'personalized')
              .map((step) => step.step_no) ?? [];
          const genericCopies = Math.min(genericRemaining, allocation.count);
          genericRemaining -= genericCopies;
          const stepSpecificCopies = Math.min(
            stepSpecificRemaining,
            allocation.count * Math.max(1, personalizedSteps.length),
          );
          stepSpecificRemaining -= stepSpecificCopies;
          const resolvedGenericCopyStepNo =
            allocation.generic_copy_step_no ??
            (personalizedSteps.length === 1 ? personalizedSteps[0]! : null);
          const genericCopyStepRequired =
            genericCopies > 0 && personalizedSteps.length > 1 && resolvedGenericCopyStepNo === null;
          const copiesBound =
            stepSpecificCopies + (resolvedGenericCopyStepNo === null ? 0 : genericCopies);
          return {
            campaign_id: allocation.campaign_id,
            requested: allocation.count,
            allocatable: requested <= total ? allocation.count : 0,
            draft_reserved: 0,
            personalized_steps: personalizedSteps,
            generic_copies: genericCopies,
            resolved_generic_copy_step_no: resolvedGenericCopyStepNo,
            generic_copy_step_required: genericCopyStepRequired,
            copies_bound: copiesBound,
            copies_unassigned: genericCopies + stepSpecificCopies - copiesBound,
          };
        }),
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
        wait_day_mode: body.wait_day_mode ?? 'elapsed_days',
        stop_on_reply: body.stop_on_reply,
        stop_on_hard_bounce: true,
        stop_on_unsubscribe: true,
        variable_defaults: body.variable_defaults,
        steps: body.steps.map((step) => ({
          id: db.nextId++,
          step_no: step.step_no,
          wait_days: step.wait_days,
          in_thread: step.in_thread,
          content_source: step.content_source,
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
        wait_day_mode: body.wait_day_mode ?? existing.wait_day_mode,
        stop_on_reply: body.stop_on_reply,
        stop_on_hard_bounce: true,
        stop_on_unsubscribe: true,
        variable_defaults: body.variable_defaults,
        steps: body.steps.map((step) => ({
          id: step.id ?? db.nextId++,
          step_no: step.step_no,
          wait_days: step.wait_days,
          in_thread: step.in_thread,
          content_source: step.content_source,
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
      const mailbox = db.mailboxes.find((item) => item.id === body.mailbox_id);
      const domain =
        mailbox?.from_address.split('@')[1] ?? '[sender domain — select a preview mailbox]';
      const content = bodyPreFooter
        .trimEnd()
        .replace(/(?:^|\n)\s*Best,\s*$/i, '')
        .trimEnd();
      const signature = `\n\nBest,\n${db.compliance.signature_name}\n${db.compliance.signature_role_line}${db.compliance.include_postal_address === false ? `\n${domain}` : ` | ${domain}`}`;
      const footer =
        db.compliance.include_postal_address === false ? '' : `\n${db.compliance.physical_address}`;
      return HttpResponse.json({
        subject,
        body: content + signature + footer,
        email_format: db.compliance.email_format,
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
      if (
        db.campaigns.some((campaign) => campaign.sequence_id === sequence.id) ||
        mockSequenceHasScheduleHistory(sequence.id)
      )
        return err('conflict', 'sequence has campaign or schedule-change history', 409);
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
        tier_effort_config: {
          A: 'template_researched' as const,
          B: 'template_auto' as const,
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
        lead_selection_mode: 'global' as const,
        auto_enroll_enabled: false,
        steady_daily_enroll_cap: body.steady_daily_enroll_cap ?? body.ramp_stages.at(-1)?.cap ?? 15,
        pool_summary: {
          total: 0,
          available: 0,
          enrolled: 0,
          released: 0,
          temporarily_ineligible: 0,
          source_imports: 0,
        },
        last_auto_enrollment_run: null,
        recycle_sources: [],
        recycled_from_campaign_id: null,
        enrolled_count: 0,
        contacted_count: 0,
        delivery_confirmed_count: 0,
        pending_delivery_confirmation_count: 0,
        finished_count: 0,
        finishing_count: 0,
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
      const campaign = db.campaigns.find((c) => c.id === Number(params.id));
      if (!campaign) return notFound('campaign');
      return HttpResponse.json({
        ...db.overview.capacity,
        effective_daily_enroll_cap: campaign.steady_daily_enroll_cap,
        campaign_cap_remaining: Math.max(
          0,
          campaign.steady_daily_enroll_cap - db.overview.capacity.enrolled_today,
        ),
        pool_available:
          campaign.lead_selection_mode === 'pool' ? campaign.pool_summary.available : null,
      });
    }),
  ),
  http.get(
    `${BASE}/campaigns/:id/pool`,
    authed(({ request, params }) => {
      const campaign = db.campaigns.find((item) => item.id === Number(params.id));
      if (!campaign) return notFound('campaign');
      const url = new URL(request.url);
      const status = url.searchParams.get('status');
      const items = db.campaignPools.filter(
        (item) => item.campaign_id === campaign.id && (!status || item.status === status),
      );
      return HttpResponse.json({ ...paginate(items, url), summary: campaign.pool_summary });
    }),
  ),
  http.post(
    `${BASE}/campaigns/:id/pool/add`,
    authed(async ({ request, params }) => {
      const campaign = db.campaigns.find((item) => item.id === Number(params.id));
      if (!campaign) return notFound('campaign');
      const body = await parseBody(request, poolAddBodySchema);
      if (body instanceof Response) return body;
      const candidates = db.leads
        .filter(
          (lead) =>
            !lead.is_suppressed &&
            lead.outreach_status !== 'nurture' &&
            !db.campaignPools.some(
              (pool) => pool.lead.id === lead.id && pool.status === 'available',
            ),
        )
        .slice(0, body.count);
      if (candidates.length < body.count) return err('conflict', 'not enough safe leads', 409);
      for (const lead of candidates) {
        db.campaignPools.push({
          id: db.nextId++,
          campaign_id: campaign.id,
          lead: {
            id: lead.id,
            email: lead.email,
            first_name: lead.first_name,
            last_name: lead.last_name,
            company: lead.company,
            tier: lead.tier,
          },
          source_import_id: body.source_import_id ?? null,
          allocation_order: db.nextId++,
          status: 'available',
          enrollment_id: null,
          last_eligibility_reason: null,
          allocated_at: NOW,
          enrolled_at: null,
          released_at: null,
        });
        lead.pool_assignment = {
          campaign_id: campaign.id,
          campaign_name: campaign.name,
          status: 'available',
        };
      }
      campaign.lead_selection_mode = 'pool';
      campaign.pool_summary.total += candidates.length;
      campaign.pool_summary.available += candidates.length;
      return HttpResponse.json({ changed: candidates.length, skipped: [] });
    }),
  ),
  http.post(
    `${BASE}/campaigns/:id/pool/release`,
    authed(async ({ request, params }) => {
      const campaign = db.campaigns.find((item) => item.id === Number(params.id));
      if (!campaign) return notFound('campaign');
      const body = await parseBody(request, poolLeadIdsBodySchema);
      if (body instanceof Response) return body;
      let changed = 0;
      for (const item of db.campaignPools) {
        if (
          item.campaign_id === campaign.id &&
          item.status === 'available' &&
          body.lead_ids.includes(item.lead.id)
        ) {
          item.status = 'released';
          item.released_at = NOW;
          const lead = db.leads.find((candidate) => candidate.id === item.lead.id);
          if (lead) delete lead.pool_assignment;
          changed += 1;
        }
      }
      campaign.pool_summary.available -= changed;
      campaign.pool_summary.released += changed;
      return HttpResponse.json({ changed, skipped: [] });
    }),
  ),
  http.post(
    `${BASE}/campaigns/:id/pool/reassign`,
    authed(async ({ request, params }) => {
      const source = db.campaigns.find((item) => item.id === Number(params.id));
      if (!source) return notFound('campaign');
      const body = await parseBody(request, poolReassignBodySchema);
      if (body instanceof Response) return body;
      const target = db.campaigns.find((item) => item.id === body.target_campaign_id);
      if (!target) return notFound('campaign');
      let changed = 0;
      for (const item of db.campaignPools) {
        if (
          item.campaign_id === source.id &&
          item.status === 'available' &&
          body.lead_ids.includes(item.lead.id)
        ) {
          item.campaign_id = target.id;
          const lead = db.leads.find((candidate) => candidate.id === item.lead.id);
          if (lead) {
            lead.pool_assignment = {
              campaign_id: target.id,
              campaign_name: target.name,
              status: 'available',
            };
          }
          changed += 1;
        }
      }
      source.pool_summary.available -= changed;
      source.pool_summary.total -= changed;
      target.pool_summary.available += changed;
      target.pool_summary.total += changed;
      target.lead_selection_mode = 'pool';
      return HttpResponse.json({ changed, skipped: [] });
    }),
  ),
  http.patch(
    `${BASE}/campaigns/:id/auto-enrollment`,
    authed(async ({ request, params }) => {
      const campaign = db.campaigns.find((item) => item.id === Number(params.id));
      if (!campaign) return notFound('campaign');
      const body = await parseBody(request, patchAutoEnrollmentBodySchema);
      if (body instanceof Response) return body;
      campaign.auto_enroll_enabled = body.enabled;
      let run = null;
      if (body.enabled && campaign.status === 'active') {
        const enrolled = Math.min(
          campaign.pool_summary.available,
          campaign.steady_daily_enroll_cap,
          db.overview.capacity.room_for_new,
        );
        run = {
          id: db.nextId++,
          trigger: 'enabled' as const,
          local_date: '2026-02-21',
          status: 'completed' as const,
          enrolled,
          started_at: NOW,
          completed_at: NOW,
          error: null,
        };
        db.autoEnrollmentRuns.unshift({ ...run, campaign_id: campaign.id });
        campaign.last_auto_enrollment_run = run;
      }
      return HttpResponse.json({ campaign, run });
    }),
  ),
  http.get(
    `${BASE}/campaigns/:id/auto-enrollment/runs`,
    authed(({ request, params }) => {
      const rows = db.autoEnrollmentRuns
        .filter((run) => run.campaign_id === Number(params.id))
        .map(({ campaign_id: _campaignId, ...run }) => run);
      return HttpResponse.json(paginate(rows, new URL(request.url)));
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
    `${BASE}/campaigns/:id/recycle/preview`,
    authed(async ({ request, params }) => {
      const target = db.campaigns.find((campaign) => campaign.id === Number(params.id));
      if (!target) return notFound('campaign');
      const body = await parseBody(request, recyclePreviewBodySchema);
      if (body instanceof Response) return body;
      if (target.status !== 'draft')
        return err('conflict', 'recycle target must be a draft campaign', 409);
      return HttpResponse.json({
        breakdown: {
          unique_leads: 284,
          duplicates: 36,
          rest_period_failures: 42,
          nurture_exclusions: 10,
          untiered_exclusions: 0,
          personalized_copy_blocks: 0,
          suppression_recontact_blocks: 8,
          existing_target_enrollments: 4,
          prior_content_conflicts: 12,
          eligible: 208,
        },
        sources: body.source_campaign_ids.map((sourceId, index) => ({
          source_campaign_id: sourceId,
          name:
            db.campaigns.find((campaign) => campaign.id === sourceId)?.name ??
            `Campaign ${sourceId}`,
          candidates: index === 0 ? 180 : 140,
          eligible: index === 0 ? 124 : 108,
        })),
      });
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
      const sourceIds =
        'source_campaign_ids' in body ? body.source_campaign_ids : [body.source_campaign_id];
      target.recycle_sources = sourceIds.map((sourceId) => ({
        campaign_id: sourceId,
        name:
          db.campaigns.find((campaign) => campaign.id === sourceId)?.name ?? `Campaign ${sourceId}`,
        contributed_leads: 120,
      }));
      target.recycled_from_campaign_id = sourceIds.length === 1 ? sourceIds[0]! : null;
      target.enrolled_count += 120;
      return HttpResponse.json({
        enrolled: 120,
        skipped: [{ reason: 'resting', count: 660 }],
        breakdown: {
          unique_leads: 284,
          duplicates: 36,
          rest_period_failures: 42,
          nurture_exclusions: 10,
          untiered_exclusions: 0,
          personalized_copy_blocks: 0,
          suppression_recontact_blocks: 8,
          existing_target_enrollments: 4,
          prior_content_conflicts: 12,
          eligible: 120,
        },
        sources: sourceIds.map((sourceId, index) => ({
          source_campaign_id: sourceId,
          name:
            db.campaigns.find((campaign) => campaign.id === sourceId)?.name ??
            `Campaign ${sourceId}`,
          candidates: index === 0 ? 180 : 140,
          eligible: index === 0 ? 70 : 50,
        })),
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
    authed(() =>
      err(
        'conflict',
        'manual sending is retired; save Personalized Copy and send through a sequence',
        410,
      ),
    ),
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
    authed(({ request }) => {
      const stepNo = Number(new URL(request.url).searchParams.get('step_no') ?? 1);
      const makeMetric = (numerator: number, denominator: number) => ({
        numerator,
        denominator,
        value: denominator === 0 ? null : Math.round((numerator / denominator) * 1000) / 10,
      });
      const variants =
        db.sequences[0]?.steps.find((step) => step.step_no === stepNo)?.variants ?? [];
      const activeCount = variants.filter((variant) => variant.active).length;
      const profiles = [
        {
          sent: 443,
          delivered: 434,
          directReplies: 40,
          directPositive: 16,
          eventualReplies: 52,
          eventualPositive: 21,
          meetings: 10,
        },
        {
          sent: 442,
          delivered: 433,
          directReplies: 32,
          directPositive: 12,
          eventualReplies: 45,
          eventualPositive: 18,
          meetings: 7,
        },
      ];
      return HttpResponse.json({
        items: variants.map((variant, index) => {
          const profile = profiles[index] ?? profiles[0]!;
          return {
            variant_id: variant.id,
            label: variant.label,
            subject_template: variant.subject_template,
            active: variant.active,
            bespoke: false,
            deactivatable: variant.active && activeCount > 1,
            direct: {
              sent: profile.sent,
              delivered: profile.delivered,
              contacted: profile.delivered,
              replies: profile.directReplies,
              positive_replies: profile.directPositive,
              reply_rate: makeMetric(profile.directReplies, profile.delivered),
              positive_rate: makeMetric(profile.directPositive, profile.delivered),
            },
            eventual: {
              cohort: profile.sent,
              replies: profile.eventualReplies,
              positive_replies: profile.eventualPositive,
              meetings: profile.meetings,
              reply_rate: makeMetric(profile.eventualReplies, profile.sent),
              positive_rate: makeMetric(profile.eventualPositive, profile.sent),
            },
            sent: profile.sent,
            reply_rate: makeMetric(profile.eventualReplies, profile.sent),
            positive_rate: makeMetric(profile.eventualPositive, profile.sent),
            meetings: profile.meetings,
          };
        }),
      });
    }),
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
      const step = db.sequences
        .flatMap((sequence) => sequence.steps)
        .find((candidate) => candidate.variants.some((entry) => entry.id === variant.id));
      if ((step?.variants.filter((entry) => entry.active).length ?? 0) <= 1)
        return err('conflict', 'the final active automated variant cannot be deactivated', 409);
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
      if (
        (body.include_postal_address ?? db.compliance.include_postal_address ?? true) &&
        body.physical_address.trim() === ''
      )
        return err('validation', 'physical_address must not be empty', 422);
      db.compliance = {
        ...body,
        include_postal_address: body.include_postal_address ?? db.compliance.include_postal_address,
      };
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
      return HttpResponse.json({
        ...paginate(items, url),
        ack_through_id: Math.max(0, ...db.alerts.map((a) => a.id)),
      });
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
  http.post(
    `${BASE}/alerts/ack-all`,
    authed(async ({ request }) => {
      const body = (await request.json()) as { through_id: number };
      for (const alert of db.alerts)
        if (alert.id <= body.through_id && !alert.acknowledged_at) alert.acknowledged_at = NOW;
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
        personalized_copy_blocked_count: 0,
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
