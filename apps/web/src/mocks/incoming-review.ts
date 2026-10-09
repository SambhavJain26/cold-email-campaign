import { http, HttpResponse, type RequestHandler } from 'msw';
import {
  reviewActionSchema,
  incomingAckSchema,
  incomingLinkSchema,
  incomingAuthorshipBodySchema,
  reviewMutationSchema,
  incomingRetentionSchema,
  type IncomingReviewRow,
  type IncomingReviewMessage,
} from '@coldemail/shared';
import { db, NOW } from './db';

const base = '/api/v1/unibox';
const row: IncomingReviewRow = {
  lead_id: 901,
  enrollment_id: 901,
  campaign_id: 1,
  name: 'Alex Rivera',
  email: 'alex@apex.example',
  company: 'Apex Realty',
  campaign_name: 'Golden Pass 1',
  campaign_status: 'active',
  sending_state: 'held',
  lifecycle: 'ACTIVE',
  stop_origin: null,
  delayed_until: null,
  assigned_mailbox_id: 1,
  next_send_at: NOW,
  resume_due_at: null,
  next_step: 2,
  revision: 1,
  hold_ids: [9001],
  message_count: 2,
  unacknowledged_count: 2,
  latest_received_at: NOW,
};
const makeMessage = (id: number): IncomingReviewMessage => ({
  id,
  from_address: row.email,
  subject: id === 901 ? 'Away for three days' : 'Automatic reply: Out of office',
  received_at: NOW,
  automation: id === 901 ? 'not_detected' : 'automatic',
  relationship: id === 901 ? 'in_thread' : 'separate',
  authorship: 'unsure',
  sentiment: null,
  policy_version: 'review_v1',
  revision: 0,
  linking_status: 'linked',
  primary_enrollment_id: 901,
  body_text: 'I am away for three days.\n\nPlease check back next week.\n\n> Previous message',
  body_html:
    '<p>I am away for three days.</p><p>Please check back next week.</p><blockquote>Previous message</blockquote><img src="https://tracking.invalid/pixel"><script>parent.emailScriptRan=true</script>',
  new_text: 'I am away for three days.\n\nPlease check back next week.',
  quoted_text: '> Previous message',
  snippet: 'I am away for three days.',
  capture_status: 'captured',
  acknowledged: false,
  links: [{ lead_id: 901, campaign_id: 1, enrollment_id: 901, matching_method: 'exact_address' }],
  history: [
    {
      id,
      kind: 'received',
      occurred_at: NOW,
      attributes: { holds: [{ id: 9001, enrollment_id: 901 }] },
    },
  ],
});
const messages = [
  makeMessage(901),
  makeMessage(902),
  {
    ...makeMessage(903),
    from_address: 'other@apex.example',
    subject: 'Separate company message',
    relationship: 'unmatched' as const,
    links: [],
    linking_status: 'needs_linking',
    primary_enrollment_id: null,
    history: [],
  },
];
let retention: number | null = 30;
const failure = (message: string, status = 409) =>
  HttpResponse.json(
    { error: { code: status === 401 ? 'unauthorized' : 'conflict', message } },
    { status },
  );
const allowed = () => db.authenticated;
const reply = (value: unknown) =>
  allowed()
    ? new HttpResponse(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })
    : failure('authentication required', 401);
const updateCounts = () => {
  row.unacknowledged_count = messages.filter(
    (m) =>
      m.links.some((l) => l.lead_id === row.lead_id && l.campaign_id === row.campaign_id) &&
      !m.acknowledged,
  ).length;
  row.message_count = messages.filter((m) =>
    m.links.some((l) => l.lead_id === row.lead_id && l.campaign_id === row.campaign_id),
  ).length;
};
const page = (items: unknown[], url: URL) => {
  const number = Number(url.searchParams.get('page') ?? 1),
    size = Number(url.searchParams.get('per_page') ?? 25);
  return {
    items: items.slice((number - 1) * size, number * size),
    total: items.length,
    page: number,
    per_page: size,
  };
};
const possible = (message: IncomingReviewMessage) => ({
  message,
  candidates: [
    {
      enrollment_id: row.enrollment_id,
      lead_id: row.lead_id,
      campaign_id: row.campaign_id,
      name: row.name,
      email: row.email,
      company: row.company,
      campaign_name: row.campaign_name,
      campaign_status: row.campaign_status,
      sending_state: row.sending_state,
      delayed_until: row.delayed_until,
      sent_message_id: '<mock-out@example>',
      sent_at: NOW,
      subject_match: false,
      company_match: true,
    },
  ],
});
const queue = (url: URL) => {
  updateCounts();
  const view = url.searchParams.get('view') ?? 'needs_review';
  const campaign = url.searchParams.get('campaign_id');
  const search = (url.searchParams.get('search') ?? '').toLowerCase();
  const visible = (acknowledged: boolean) =>
    view === 'all' || (view === 'acknowledged' ? acknowledged : !acknowledged);
  const campaignFits = !campaign || Number(campaign) === row.campaign_id;
  const leadItems =
    campaignFits &&
    visible(row.unacknowledged_count === 0) &&
    `${row.name} ${row.email} ${row.company}`.toLowerCase().includes(search) &&
    (!url.searchParams.get('sending_state') ||
      row.sending_state === url.searchParams.get('sending_state'))
      ? [{ kind: 'lead', row }]
      : [];
  const possibleItems = campaignFits
    ? messages
        .filter(
          (m) =>
            !m.links.length &&
            visible(m.acknowledged) &&
            `${m.from_address} ${m.subject} ${row.name} ${row.email} ${row.company}`
              .toLowerCase()
              .includes(search),
        )
        .map((m) => ({ kind: 'possible', item: possible(m) }))
    : [];
  return {
    ...page([...leadItems, ...possibleItems], url),
    lead_count: leadItems.length,
    possible_count: possibleItems.length,
  };
};
export const incomingReviewHandlers: RequestHandler[] = [
  http.get(`${base}/review-queue/v1`, ({ request }) => reply(queue(new URL(request.url)))),
  http.get(`${base}/review-summary/v1`, ({ request }) => {
    const q = queue(new URL(request.url));
    return reply({
      lead_count: q.lead_count,
      possible_count: q.possible_count,
      mailboxes: [{ id: 1, name: 'Mailbox 1', status: 'ok', last_checked_at: NOW, stale: false }],
    });
  }),
  http.get(`${base}/messages/:id/possible-detail`, ({ params }) =>
    reply(possible(messages.find((m) => m.id === Number(params.id))!)),
  ),
  http.post(`${base}/messages/:id/candidate-visibility`, async ({ request, params }) => {
    if (!allowed()) return failure('authentication required', 401);
    const body = (await request.json()) as {
      expected_revision: number;
      action: 'dismiss' | 'return';
    };
    const m = messages.find((m) => m.id === Number(params.id))!;
    if (m.revision !== body.expected_revision || m.links.length)
      return failure('The message changed. Refresh before deciding.');
    m.acknowledged = body.action === 'dismiss';
    m.linking_status = m.acknowledged ? 'unrelated' : 'needs_linking';
    m.revision++;
    return reply({ ok: true });
  }),
  http.post(`${base}/messages/:id/confirm-candidate`, async ({ request, params }) => {
    if (!allowed()) return failure('authentication required', 401);
    const body = incomingLinkSchema.parse(await request.json());
    const m = messages.find((m) => m.id === Number(params.id))!;
    if (
      m.revision !== body.expected_revision ||
      m.links.length ||
      body.lead_id !== row.lead_id ||
      body.campaign_id !== row.campaign_id
    )
      return failure('The message changed. Refresh before deciding.');
    m.links = [
      {
        lead_id: row.lead_id,
        campaign_id: row.campaign_id,
        enrollment_id: row.enrollment_id,
        matching_method: 'manual',
      },
    ];
    m.linking_status = 'linked';
    m.primary_enrollment_id = row.enrollment_id;
    m.relationship = 'separate';
    m.acknowledged = false;
    m.revision++;
    row.sending_state = 'held';
    row.hold_ids = [9001];
    row.revision++;
    updateCounts();
    return reply({ ok: true });
  }),
  http.post('/api/v1/unibox/:id/reminders', async ({ request, params }) => {
    if (!allowed()) return failure('authentication required', 401);
    const body = (await request.json()) as { due_date: string; note?: string };
    const message = messages.find((m) => m.id === Number(params.id))!;
    db.reminders.push({
      ...db.reminders[0]!,
      id: db.nextId++,
      enrollment_id: 901,
      incoming_message_id: message.id,
      due_date: body.due_date,
      note: body.note ?? null,
      source: 'manual',
      status: 'open',
      created_at: NOW,
      completed_at: null,
      lead: { ...db.unibox[0]!.lead, id: 901, name: row.name! },
      campaign_id: 1,
      reply_snippet: message.snippet,
    });
    return reply({ ok: true });
  }),
  http.get(`${base}/rows`, ({ request }) => {
    const url = new URL(request.url);
    const view = url.searchParams.get('view') ?? 'needs_review';
    const search = (url.searchParams.get('search') ?? '').toLowerCase();
    const campaign = url.searchParams.get('campaign_id');
    updateCounts();
    const items = [row].filter(
      (r) =>
        (!campaign || r.campaign_id === Number(campaign)) &&
        `${r.name} ${r.email} ${r.company}`.toLowerCase().includes(search) &&
        (view === 'all' ||
          (view === 'acknowledged' ? r.unacknowledged_count === 0 : r.unacknowledged_count > 0)) &&
        (!url.searchParams.get('sending_state') ||
          r.sending_state === url.searchParams.get('sending_state')),
    );
    return reply(page(items, url));
  }),
  http.get(`${base}/rows/:id/messages`, () =>
    reply({
      row,
      messages: messages.filter((m) => m.links.length),
      history: [],
      sent: [
        {
          message_id: '<mock-out@example>',
          step_no: 1,
          sent_at: NOW,
          subject: 'An earlier conversation',
          body_text: 'Saved sent message text.',
          conversation_id: '<mock-out@example>',
        },
      ],
    }),
  ),
  http.get(`${base}/needs-linking`, ({ request }) =>
    reply(
      page(
        messages.filter(
          (m) =>
            ['needs_linking', 'unrelated'].includes(m.linking_status) &&
            (new URL(request.url).searchParams.get('view') === 'all' ||
              (new URL(request.url).searchParams.get('view') === 'acknowledged'
                ? m.acknowledged
                : !m.acknowledged)),
        ),
        new URL(request.url),
      ),
    ),
  ),
  http.get(`${base}/link-candidates`, ({ request }) => {
    const url = new URL(request.url);
    const search = (url.searchParams.get('search') ?? '').toLowerCase();
    return reply({
      items:
        Number(url.searchParams.get('campaign_id')) === 1 &&
        `${row.name} ${row.email} ${row.company}`.toLowerCase().includes(search)
          ? [
              {
                lead_id: row.lead_id,
                enrollment_id: row.enrollment_id,
                name: row.name,
                email: row.email,
                company: row.company,
                state: row.sending_state,
              },
            ]
          : [],
    });
  }),
  http.get(`${base}/messages/:id`, ({ params }) =>
    reply(messages.find((m) => m.id === Number(params.id))),
  ),
  http.get(`${base}/retention`, () => reply({ days: retention })),
  http.put(`${base}/retention`, async ({ request }) => {
    if (!allowed()) return failure('authentication required', 401);
    retention = incomingRetentionSchema.parse(await request.json()).days;
    return reply({ days: retention });
  }),
  http.post(`${base}/rows/:id/action`, async ({ request }) => {
    if (!allowed()) return failure('authentication required', 401);
    const body = reviewActionSchema.parse(await request.json());
    if (body.expected_revision !== row.revision)
      return failure('New information arrived. Refresh and review current messages.');
    if (row.sending_state === 'suppressed')
      return failure('This address is permanently protected.');
    if (body.action === 'suppress' && body.confirm !== row.email)
      return failure('Type the complete email address.', 400);
    if (body.action === 'continue' && !body.hold_ids.length)
      return failure('Review the relevant messages first.');
    if (body.action === 'continue' || body.action === 'delay') {
      row.hold_ids = row.hold_ids.filter((id) => !body.hold_ids.includes(id));
      if (body.action === 'delay') row.delayed_until = body.until ?? null;
      row.sending_state = row.hold_ids.length
        ? 'held'
        : row.delayed_until && new Date(row.delayed_until) > new Date()
          ? 'delayed'
          : 'running';
    } else if (body.action === 'stop') {
      row.sending_state = 'stopped';
      row.lifecycle = 'STOPPED';
      row.stop_origin = 'manual';
      row.hold_ids = [];
    } else if (body.action === 'suppress') row.sending_state = 'suppressed';
    else {
      row.sending_state = 'held';
      row.lifecycle = 'ACTIVE';
      row.hold_ids = [9001];
      row.stop_origin = null;
    }
    row.revision++;
    return reply({ ok: true });
  }),
  http.post(`${base}/acknowledgements`, async ({ request }) => {
    if (!allowed()) return failure('authentication required', 401);
    const body = incomingAckSchema.parse(await request.json());
    const selected = body.messages.map((item) => messages.find((m) => m.id === item.id)!);
    if (selected.some((m, index) => !m || m.revision !== body.messages[index]!.expected_revision))
      return failure('The message changed.');
    if (
      body.action === 'acknowledge' &&
      selected.some(
        (m) =>
          m.linking_status === 'needs_linking' ||
          (m.links.length > 0 && row.sending_state === 'held'),
      )
    )
      return failure('Resolve holds before acknowledging.');
    for (const m of selected) {
      m.acknowledged = body.action === 'acknowledge';
      m.revision++;
    }
    updateCounts();
    return reply({ ok: true });
  }),
  http.post(`${base}/messages/:id/authorship`, async ({ request, params }) => {
    if (!allowed()) return failure('authentication required', 401);
    const body = incomingAuthorshipBodySchema.parse(await request.json());
    const m = messages.find((item) => item.id === Number(params.id))!;
    if (m.revision !== body.expected_revision) return failure('Refresh the message.');
    m.authorship = body.authorship;
    m.sentiment = body.authorship === 'human' ? (body.sentiment ?? null) : null;
    m.revision++;
    return reply(m);
  }),
  http.post(`${base}/messages/:id/link`, async ({ request, params }) => {
    if (!allowed()) return failure('authentication required', 401);
    const body = incomingLinkSchema.parse(await request.json());
    const m = messages.find((item) => item.id === Number(params.id))!;
    if (m.revision !== body.expected_revision) return failure('Refresh the message.');
    m.links = [
      {
        lead_id: body.lead_id,
        campaign_id: body.campaign_id,
        enrollment_id: 901,
        matching_method: 'manual',
      },
    ];
    m.primary_enrollment_id = 901;
    m.relationship = 'separate';
    m.linking_status = 'linked';
    m.revision++;
    row.sending_state = 'held';
    row.hold_ids = [9001];
    row.revision++;
    return reply(m);
  }),
  http.post(`${base}/messages/:id/unrelated`, async ({ request, params }) => {
    if (!allowed()) return failure('authentication required', 401);
    const body = reviewMutationSchema.parse(await request.json());
    const m = messages.find((item) => item.id === Number(params.id))!;
    if (m.revision !== body.expected_revision) return failure('Refresh the message.');
    m.linking_status = 'unrelated';
    m.revision++;
    return reply(m);
  }),
  http.delete(`${base}/messages/:id/content`, async ({ request, params }) => {
    if (!allowed()) return failure('authentication required', 401);
    const body = reviewMutationSchema.parse(await request.json());
    const m = messages.find((item) => item.id === Number(params.id))!;
    if (m.revision !== body.expected_revision) return failure('Refresh the message.');
    m.capture_status = 'deleted';
    m.body_text = m.body_html = m.new_text = m.quoted_text = m.snippet = null;
    m.revision++;
    return reply(m);
  }),
];
