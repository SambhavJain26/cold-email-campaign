// F0.4 — the in-memory mock state (docs/11 §4). Everything the handlers serve
// derives from the golden-cohort fixtures (B2.18/B6.13 exports — the spec's
// numbers: 885/867/72/28/17…) plus deterministic synthesized entities for the
// route groups the exporter doesn't cover. Mutations mutate this state so
// flows are exercisable end-to-end offline.
import type {
  AlertDto,
  CampaignDto,
  CampaignPoolItemDto,
  AutoEnrollmentRunSummaryDto,
  ComplianceDto,
  EventViewDto,
  ImportDto,
  LeadDto,
  MailboxDto,
  ReminderDto,
  SequenceDto,
  UniboxItemDto,
} from '@coldemail/shared';
import campaignsFx from './fixtures/golden/campaigns.json';
import outcomesFx from './fixtures/golden/outcomes.json';
import overviewFx from './fixtures/golden/overview.json';
import stepsFx from './fixtures/golden/analytics-steps.json';
import tiersFx from './fixtures/golden/analytics-tiers.json';
import healthFx from './fixtures/golden/health-trend.json';
import volumeFx from './fixtures/golden/mailbox-volume.json';

/** Failure-fixture toggle (docs/11 §4): flips mailbox 3 auth_failed, mailbox 4
 *  auto_paused, injects catchup_backlog — so F2/F8 failure panels are buildable.
 *  Enable via localStorage 'mock:failures' = '1' or VITE_MOCK_FAILURES=true. */
function failuresEnabled(): boolean {
  if (import.meta.env?.VITE_MOCK_FAILURES === 'true') return true;
  try {
    return globalThis.localStorage?.getItem('mock:failures') === '1';
  } catch {
    return false;
  }
}

function sessionAuthed(): boolean {
  try {
    return globalThis.sessionStorage?.getItem('mock:auth') === '1';
  } catch {
    return false;
  }
}

export function persistSession(authenticated: boolean): void {
  try {
    if (authenticated) globalThis.sessionStorage?.setItem('mock:auth', '1');
    else globalThis.sessionStorage?.removeItem('mock:auth');
  } catch {
    /* non-browser env */
  }
}

const OPERATOR_EMAIL = 'operator@example.com';
const NOW = '2026-02-21T15:00:00.000Z'; // just past the golden campaign's end

const FIRST = ['Sarah', 'Mike', 'Jen', 'Tom', 'Lisa', 'Dave', 'Amy', 'Chris', 'Kate', 'Ryan'];
const LAST = ['Chen', 'Rodriguez', 'Patel', 'Kim', 'Nguyen', 'Brooks', 'Silva', 'Hayes'];
const COMPANY = ['Apex Realty', 'BlueKey Homes', 'Cornerstone Group', 'Dwell Partners'];
const CITY_STATE: Array<[string, string]> = [
  ['Austin', 'TX'],
  ['Denver', 'CO'],
  ['Tampa', 'FL'],
  ['Phoenix', 'AZ'],
  ['Columbus', 'OH'],
];

/** 885-lead projection consistent with the outcomes fixture:
 *  1–47 REPLIED (first 28 positive) · 48–87 UNSUBSCRIBED · 88–105 BOUNCED ·
 *  106–885 COMPLETED. Current tiers migrate the historic C cohort into B:
 *  A 255 / B 612 contacted + 18 untiered. Historical analytics fixtures keep
 *  their immutable C enrollment snapshots. */
function buildLeads(): LeadDto[] {
  const leads: LeadDto[] = [];
  let tieredRank = 0; // rank among NON-bounced so tier totals hit A 255 / B 447 / C 165
  for (let i = 1; i <= 885; i++) {
    const state =
      i <= 47 ? 'REPLIED' : i <= 87 ? 'UNSUBSCRIBED' : i <= 105 ? 'BOUNCED' : 'COMPLETED';
    const bounced = state === 'BOUNCED';
    if (!bounced) tieredRank += 1;
    const tier = bounced ? null : tieredRank <= 255 ? 'A' : 'B';
    const first = FIRST[i % FIRST.length]!;
    const last = LAST[i % LAST.length]!;
    const [city, st] = CITY_STATE[i % CITY_STATE.length]!;
    leads.push({
      id: i,
      email: `${first.toLowerCase()}.${last.toLowerCase()}${i}@example.com`,
      first_name: i % 11 === 0 ? null : first, // some nameless (missing_first_name rows)
      last_name: last,
      company: COMPANY[i % COMPANY.length]!,
      city,
      state: st,
      tier,
      outreach_status: 'standard',
      is_suppressed: state === 'UNSUBSCRIBED',
      custom_fields: i % 7 === 0 ? { listing_note: 'Saw the Elm St listing' } : {},
      latest_enrollment: {
        campaign_id: 1,
        campaign_name: 'Local mock campaign',
        current_state: state,
        current_step_no: bounced ? 1 : state === 'REPLIED' ? Math.min(1 + (i % 4), 4) : 4,
        awaiting_completion: false,
      },
    });
  }
  // A separate active legacy Mode-1 enrollment proves predecessor work stays
  // held and readable while Personalized Copy is the only current workflow.
  leads.push({
    id: 886,
    email: 'manual.eligible@example.com',
    first_name: 'Manual',
    last_name: 'Eligible',
    company: 'Fixture Realty',
    city: 'Austin',
    state: 'TX',
    // Kept out of the current A/B distribution; its active Mode-1 enrollment
    // is a legacy compatibility fixture.
    tier: null,
    outreach_status: 'nurture',
    is_suppressed: false,
    custom_fields: {},
    latest_enrollment: {
      campaign_id: 2,
      campaign_name: 'Manual Send Fixture',
      current_state: 'ACTIVE',
      current_step_no: 0,
      awaiting_completion: false,
    },
  });
  return leads;
}

function buildMailboxes(): MailboxDto[] {
  const failures = failuresEnabled();
  return [1, 2, 3, 4].map((id) => {
    const authFailed = failures && id === 3;
    const autoPaused = failures && id === 4;
    return {
      id,
      display_name: `Sales ${id}`,
      from_address: `sales${id}@coldmail-domain${Math.ceil(id / 2)}.com`,
      smtp_host: 'smtp.fastmail.com',
      smtp_port: 465,
      imap_host: 'imap.fastmail.com',
      imap_port: 993,
      daily_cap: 30,
      effective_cap: autoPaused ? 15 : 30,
      send_window: { days: [1, 2, 3, 4, 5], start: '08:00', end: '17:00' },
      timezone: 'America/New_York',
      poll_folders: ['INBOX'], // finding 13 — INBOX-only until configured
      auth_type: 'app_password',
      oauth_connected: false,
      status: authFailed ? 'auth_failed' : autoPaused ? 'auto_paused' : 'ok',
      status_reason: authFailed
        ? 'IMAP authentication failed (535)'
        : autoPaused
          ? '3 hard bounces in last 10 sends'
          : null,
      sent_today: 0,
      hard_bounce_pct: autoPaused ? 8.0 : 0.5,
      seven_day_avg: 21.4,
      last_successful_poll_at: authFailed ? '2026-02-21T09:12:00.000Z' : NOW,
    } satisfies MailboxDto;
  });
}

function buildSequence(): SequenceDto {
  return {
    id: 1,
    name: 'Real Estate Outreach v2',
    stop_on_reply: true,
    stop_on_hard_bounce: true,
    stop_on_unsubscribe: true,
    variable_defaults: {
      competitors: 'other tools',
      offer_name: 'the service',
    },
    steps: [
      {
        id: 1,
        step_no: 1,
        wait_days: 0,
        in_thread: false,
        content_source: 'template',
        variants: [
          {
            id: 1,
            label: 'A',
            subject_template: 'Quick question about {{company}}',
            body_template:
              'Hi {{first_name|there}},\n\n{{RANDOM|Noticed|Saw}} your listings in {{city}}. {{observation}}\n\nWorth a quick chat?',
            active: true,
          },
          {
            id: 2,
            label: 'B',
            subject_template: '{{first_name|Hi}} — idea for {{company}}',
            body_template:
              'Hi {{first_name|there}},\n\n{{observation}} We help agents in {{market}} book more appraisals.\n\nOpen to 15 minutes?',
            active: true,
          },
        ],
      },
      {
        id: 2,
        step_no: 2,
        wait_days: 3,
        in_thread: true,
        content_source: 'template',
        variants: [
          {
            id: 3,
            label: 'A',
            subject_template: '(re-anchored)',
            body_template: 'Hi {{first_name|there}} — floating this back up. Any thoughts?',
            active: true,
          },
        ],
      },
      {
        id: 3,
        step_no: 3,
        wait_days: 4,
        in_thread: true,
        content_source: 'template',
        variants: [
          {
            id: 4,
            label: 'A',
            subject_template: '(re-anchored)',
            body_template:
              'Hi {{first_name|there}} — one more idea: {{RANDOM|a case study|a quick example}} from {{market}}.',
            active: true,
          },
        ],
      },
      {
        id: 4,
        step_no: 4,
        wait_days: 5,
        in_thread: true,
        content_source: 'template',
        variants: [
          {
            id: 5,
            label: 'A',
            subject_template: '(re-anchored)',
            body_template:
              'Hi {{first_name|there}} — closing the loop. If timing is bad, no worries.',
            active: true,
          },
        ],
      },
    ],
  };
}

function buildImportMappingSequence(): SequenceDto {
  return {
    id: 2,
    name: 'Import Mapping Sequence',
    stop_on_reply: true,
    stop_on_hard_bounce: true,
    stop_on_unsubscribe: true,
    variable_defaults: {},
    steps: [
      {
        id: 20,
        step_no: 1,
        wait_days: 0,
        in_thread: false,
        content_source: 'personalized',
        variants: [],
      },
      {
        id: 21,
        step_no: 3,
        wait_days: 1,
        in_thread: true,
        content_source: 'personalized',
        variants: [],
      },
    ],
  };
}

/**
 * Keep the committed golden fixture byte-for-byte equal to the real API seed.
 * Mock-only relationships and the active Mode-1 example belong here instead
 * of in that parity fixture.
 */
function buildCampaigns(): CampaignDto[] {
  const [golden] = structuredClone(campaignsFx.items) as unknown as CampaignDto[];
  return [
    {
      ...golden!,
      sequence_id: 1,
      ramp_stages: [{ start_day: 1, end_day: 7, cap: 20 }],
      first_activated_at: golden!.status === 'draft' ? null : NOW,
      variable_overrides: {},
      resolved_variables: {},
      auto_observation: { field: null, rules: {} },
      lead_selection_mode: 'global',
      auto_enroll_enabled: false,
      steady_daily_enroll_cap: 20,
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
      delivery_confirmed_count: golden!.contacted_count,
      pending_delivery_confirmation_count: 0,
      finished_count: golden!.contacted_count,
      finishing_count: 0,
    },
    {
      id: 2,
      name: 'Manual Send Fixture',
      status: 'active',
      sequence_id: 1,
      tier_effort_config: {
        A: 'human_written',
        B: 'template_researched',
        C: 'template_auto',
      },
      ramp_config: { ramp_days: 7, ramp_daily_enroll_cap: 20 },
      ramp_stages: [{ start_day: 1, end_day: 7, cap: 20 }],
      first_activated_at: NOW,
      variable_overrides: {},
      resolved_variables: {},
      auto_observation: { field: null, rules: {} },
      lead_selection_mode: 'global',
      auto_enroll_enabled: false,
      steady_daily_enroll_cap: 20,
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
      enrolled_count: 1,
      contacted_count: 0,
      delivery_confirmed_count: 0,
      pending_delivery_confirmation_count: 0,
      finished_count: 0,
      finishing_count: 0,
      manual_only_count: 1,
    },
    {
      id: 3,
      name: 'Beacon import mapping',
      status: 'draft',
      sequence_id: 2,
      tier_effort_config: {
        A: 'template_researched',
        B: 'template_auto',
        C: 'template_auto',
      },
      ramp_config: { ramp_days: 7, ramp_daily_enroll_cap: 20 },
      ramp_stages: [{ start_day: 1, end_day: 7, cap: 20 }],
      first_activated_at: null,
      variable_overrides: {},
      resolved_variables: {},
      auto_observation: { field: null, rules: {} },
      lead_selection_mode: 'global',
      auto_enroll_enabled: false,
      steady_daily_enroll_cap: 20,
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
    },
  ];
}

function buildUnibox(leads: LeadDto[]): UniboxItemDto[] {
  const items: UniboxItemDto[] = [];
  // 10 human replies off the REPLIED cohort: a mix of tagged / suggested-only /
  // auto-unsubscribed / meeting-booked, so every F6 card state has data.
  for (let n = 0; n < 10; n++) {
    const lead = leads[n]!;
    const tagged = n < 5;
    const autoUnsubscribed = n === 9;
    // The STOP card must read like one: a keyword-matched opt-out is negative
    // and auto-suppressed (decision F), never a warm "send times" reply.
    const sentiment = autoUnsubscribed
      ? 'negative'
      : n % 3 === 0
        ? 'positive'
        : n % 3 === 1
          ? 'neutral'
          : 'negative';
    items.push({
      incoming_message_id: 100 + n,
      received_at: `2026-02-${String(10 + n).padStart(2, '0')}T14:0${n % 10}:00.000Z`,
      lead: {
        id: lead.id,
        name: [lead.first_name, lead.last_name].filter(Boolean).join(' ') || lead.email,
        company: lead.company,
      },
      campaign_id: 1,
      step_no: 1 + (n % 4),
      snippet: autoUnsubscribed
        ? 'STOP. Take me off this list.'
        : sentiment === 'positive'
          ? 'Sure — send over some times next week.'
          : sentiment === 'neutral'
            ? 'Who is this? How did you get my email?'
            : 'Not interested, please stop emailing me.',
      // An auto-suppressed STOP is a settled fact, not a suggestion.
      effective_sentiment: tagged || autoUnsubscribed ? sentiment : null,
      suggested_sentiment: tagged || autoUnsubscribed ? null : sentiment,
      disposition: autoUnsubscribed ? 'explicit_unsubscribe' : null,
      recontact_after: null,
      auto_unsubscribed: autoUnsubscribed,
      lead_suppressed: autoUnsubscribed,
      sequence_continues: false,
      meeting_booked: n === 0,
      enrollment_id: lead.id,
    });
  }
  // 3 auto-replies (OOO) — the auto_reply tab.
  for (let n = 0; n < 3; n++) {
    const lead = leads[20 + n]!;
    items.push({
      incoming_message_id: 200 + n,
      received_at: `2026-02-1${n}T08:30:00.000Z`,
      lead: {
        id: lead.id,
        name: [lead.first_name, lead.last_name].filter(Boolean).join(' ') || lead.email,
        company: lead.company,
      },
      campaign_id: 1,
      step_no: 1,
      snippet: 'Out of office until Monday — I will reply on my return.',
      effective_sentiment: null,
      suggested_sentiment: null,
      disposition: null,
      recontact_after: null,
      auto_unsubscribed: false,
      lead_suppressed: false,
      sequence_continues: true,
      meeting_booked: false,
      enrollment_id: lead.id,
    });
  }
  return items;
}

function buildAlerts(): AlertDto[] {
  const alerts: AlertDto[] = [
    {
      id: 1,
      kind: 'import_committed',
      severity: 'info',
      payload: { import_id: 1, imported: 885 },
      created_at: '2026-01-04T18:00:00.000Z',
      acknowledged_at: '2026-01-04T18:05:00.000Z',
    },
  ];
  if (failuresEnabled()) {
    alerts.push(
      {
        id: 2,
        kind: 'catchup_backlog',
        severity: 'warning',
        payload: { overdue: 41, remainingBudgetToday: 9 },
        created_at: NOW,
        acknowledged_at: null,
      },
      {
        id: 3,
        kind: 'mailbox_auto_paused',
        severity: 'error',
        payload: { mailbox_id: 4, reason: '3 hard bounces in last 10 sends' },
        created_at: NOW,
        acknowledged_at: null,
      },
      {
        id: 4,
        kind: 'mailbox_auth_failed',
        severity: 'error',
        payload: { mailbox_id: 3 },
        created_at: NOW,
        acknowledged_at: null,
      },
    );
  }
  return alerts;
}

function buildTimeline(lead: LeadDto): EventViewDto[] {
  const state = lead.latest_enrollment?.current_state ?? 'COMPLETED';
  const steps = lead.latest_enrollment?.current_step_no ?? 4;
  const events: EventViewDto[] = [];
  let id = 1;
  const push = (type: EventViewDto['type'], stepNo: number | null, day: number) => {
    events.push({
      id: id++,
      type,
      occurred_at: `2026-01-${String(Math.min(5 + day, 28)).padStart(2, '0')}T15:00:00.000Z`,
      campaign_id: 1,
      enrollment_id: lead.id,
      step_no: stepNo,
      mailbox_id: stepNo === null ? null : 1 + (lead.id % 4),
      attributes: {},
    });
  };
  push('enrolled', null, 0);
  for (let s = 1; s <= steps; s++) {
    push('sent', s, s * 3);
    if (state === 'BOUNCED' && s === steps) push('hard_bounce', s, s * 3);
    else push('delivered', s, s * 3 + 1);
  }
  if (state === 'REPLIED') push('human_reply', steps, steps * 3 + 2);
  if (state === 'UNSUBSCRIBED') push('unsubscribe', steps, steps * 3 + 2);
  return events;
}

export interface MockDb {
  authenticated: boolean;
  operatorEmail: string;
  campaigns: CampaignDto[];
  outcomes: typeof outcomesFx;
  overview: Omit<typeof overviewFx, 'capacity'> & {
    capacity: (typeof overviewFx)['capacity'] & {
      ramp_day: number | null;
      ramp_stage: { start_day: number; end_day: number; cap: number } | null;
      enrolled_today: number;
      pending_openers_today: number;
      effective_daily_enroll_cap: number;
      campaign_cap_remaining: number;
      pool_available: number | null;
    };
  };
  steps: typeof stepsFx;
  tiers: typeof tiersFx;
  health: typeof healthFx;
  volume: typeof volumeFx;
  mailboxes: MailboxDto[];
  leads: LeadDto[];
  leadNotes: Map<number, string | null>;
  sequences: SequenceDto[];
  unibox: UniboxItemDto[];
  alerts: AlertDto[];
  reminders: ReminderDto[];
  imports: ImportDto[];
  campaignPools: CampaignPoolItemDto[];
  autoEnrollmentRuns: Array<AutoEnrollmentRunSummaryDto & { campaign_id: number }>;
  settings: Record<string, unknown>;
  compliance: ComplianceDto;
  nextId: number;
}

function build(): MockDb {
  const leads = buildLeads();
  return {
    authenticated: sessionAuthed(),
    operatorEmail: OPERATOR_EMAIL,
    campaigns: buildCampaigns(),
    outcomes: structuredClone(outcomesFx),
    overview: {
      ...structuredClone(overviewFx),
      capacity: {
        ...structuredClone(overviewFx.capacity),
        ramp_day: 1,
        ramp_stage: { start_day: 1, end_day: 7, cap: 20 },
        enrolled_today: 0,
        pending_openers_today: 0,
        effective_daily_enroll_cap: 20,
        campaign_cap_remaining: 20,
        pool_available: null,
      },
    },
    steps: structuredClone(stepsFx),
    tiers: structuredClone(tiersFx),
    health: structuredClone(healthFx),
    volume: structuredClone(volumeFx),
    mailboxes: buildMailboxes(),
    leads,
    leadNotes: new Map(),
    sequences: [buildSequence(), buildImportMappingSequence()],
    unibox: buildUnibox(leads),
    alerts: buildAlerts(),
    reminders: [],
    imports: [
      {
        id: 1,
        filename: 'real_estate_leads.csv',
        rows_total: 1000,
        counts: {
          ok: 885,
          missing_first_name: 82,
          role_based: 60,
          invalid: 40,
          duplicate: 15,
          suppressed: 0,
        },
        committed: true,
        commit_mode: 'drop_flagged',
        pool_allocations: [],
        created_at: '2026-01-04T18:00:00.000Z',
      },
    ],
    campaignPools: [],
    autoEnrollmentRuns: [],
    settings: {
      stop_on_reply: true,
      stop_on_hard_bounce: true,
      soft_retry_max: 3,
      suppress_unsubs: true,
      enforce_send_window: true,
      optout_detection: 'auto',
      pause_min_sends: 10,
      pause_hard_pct: 5,
      pause_window_sends: 50,
      pause_absolute_bounces: 3,
      pause_absolute_span: 10,
      resume_cap_pct: 50,
      scheduler_tick_minutes: 9,
      poll_interval_minutes: 5,
      stale_poll_hours: 2,
      delivery_confirm_hours: 6,
      send_jitter_pct: 20,
      default_timezone: 'America/New_York',
      cold_storage_rest_days: 30,
      // Launch guardrails (0011). NOTE: `settings` is typed Record<string,
      // unknown> here, so TypeScript will NOT catch a field missing from this
      // fixture — the client's zod parse fails at runtime instead.
      max_mailbox_daily_cap: 50,
      max_ramp_daily_enroll_cap: 25,
      min_ramp_days: 0,
      updated_at: '2026-01-04T12:00:00.000Z',
    },
    compliance: {
      physical_address: '4517 Congress Ave, Suite 210, Austin, TX 78745',
      optout_text: "Prefer I don't reach out? Just let me know or reply stop.",
      signature_name: 'Sambhav Jain',
      signature_role_line: 'Automation Specialist | Sambhav Builds',
      // Dormant by default — mirrors an install with no sending domain yet.
      unsubscribe_base_url: '',
    },
    nextId: 1000,
  };
}

export let db: MockDb = build();

/** Rebuild from fixtures — tests call this between cases. */
export function resetMockDb(): void {
  db = build();
}

export { buildTimeline, NOW };
