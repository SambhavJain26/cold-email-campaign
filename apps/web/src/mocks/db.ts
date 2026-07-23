// F0.4 — the in-memory mock state (docs/11 §4). Everything the handlers serve
// derives from the golden-cohort fixtures (B2.18/B6.13 exports — the spec's
// numbers: 885/867/72/28/17…) plus deterministic synthesized entities for the
// route groups the exporter doesn't cover. Mutations mutate this state so
// flows are exercisable end-to-end offline.
import type {
  AlertDto,
  CampaignDto,
  ComplianceDto,
  EventViewDto,
  ImportDto,
  LeadDto,
  MailboxDto,
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
 *  106–885 COMPLETED. Tiers: A 255 / B 447 / C 165 contacted + 18 untiered
 *  (the bounced never got delivered — and give F3's untiered banner data). */
function buildLeads(): LeadDto[] {
  const leads: LeadDto[] = [];
  for (let i = 1; i <= 885; i++) {
    const state =
      i <= 47 ? 'REPLIED' : i <= 87 ? 'UNSUBSCRIBED' : i <= 105 ? 'BOUNCED' : 'COMPLETED';
    const bounced = state === 'BOUNCED';
    const tier = bounced ? null : i <= 255 ? 'A' : i <= 702 ? 'B' : 'C';
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
      is_suppressed: state === 'UNSUBSCRIBED',
      custom_fields: i % 7 === 0 ? { listing_note: 'Saw the Elm St listing' } : {},
      latest_enrollment: {
        campaign_id: 1,
        current_state: state,
        current_step_no: bounced ? 1 : state === 'REPLIED' ? Math.min(1 + (i % 4), 4) : 4,
      },
    });
  }
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
    steps: [
      {
        id: 1,
        step_no: 1,
        wait_days: 0,
        in_thread: false,
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

function buildUnibox(leads: LeadDto[]): UniboxItemDto[] {
  const items: UniboxItemDto[] = [];
  // 10 human replies off the REPLIED cohort: a mix of tagged / suggested-only /
  // auto-unsubscribed / meeting-booked, so every F6 card state has data.
  for (let n = 0; n < 10; n++) {
    const lead = leads[n]!;
    const tagged = n < 5;
    const sentiment = n % 3 === 0 ? 'positive' : n % 3 === 1 ? 'neutral' : 'negative';
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
      snippet:
        sentiment === 'positive'
          ? 'Sure — send over some times next week.'
          : sentiment === 'neutral'
            ? 'Who is this? How did you get my email?'
            : 'Not interested, please stop emailing me.',
      effective_sentiment: tagged ? sentiment : null,
      suggested_sentiment: tagged ? null : sentiment,
      auto_unsubscribed: n === 9,
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
      auto_unsubscribed: false,
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
        payload: { missed_sends: 41, downtime_hours: 14 },
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
  overview: typeof overviewFx;
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
  imports: ImportDto[];
  settings: Record<string, unknown>;
  compliance: ComplianceDto;
  nextId: number;
}

function build(): MockDb {
  const leads = buildLeads();
  return {
    authenticated: sessionAuthed(),
    operatorEmail: OPERATOR_EMAIL,
    campaigns: structuredClone(campaignsFx.items) as CampaignDto[],
    outcomes: structuredClone(outcomesFx),
    overview: structuredClone(overviewFx),
    steps: structuredClone(stepsFx),
    tiers: structuredClone(tiersFx),
    health: structuredClone(healthFx),
    volume: structuredClone(volumeFx),
    mailboxes: buildMailboxes(),
    leads,
    leadNotes: new Map(),
    sequences: [buildSequence()],
    unibox: buildUnibox(leads),
    alerts: buildAlerts(),
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
        created_at: '2026-01-04T18:00:00.000Z',
      },
    ],
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
      updated_at: '2026-01-04T12:00:00.000Z',
    },
    compliance: {
      physical_address: '4517 Congress Ave, Suite 210, Austin, TX 78745',
      optout_text: 'If you would rather not hear from me, just reply "stop".',
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
