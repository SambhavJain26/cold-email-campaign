import { http, HttpResponse } from 'msw';
import {
  scheduleProposalSchema,
  scheduleApplyBodySchema,
  type ScheduleProposal,
  type SchedulePreview,
} from '@coldemail/shared';
import { db } from './db';

export function mockSequenceHasScheduleHistory(id: number) {
  return [...receipts.values()].some((receipt) => receipt.id === id);
}

const receipts = new Map<string, { id: number; fingerprint: string; proposal: ScheduleProposal }>();
async function preview(id: number, proposal: ScheduleProposal): Promise<SchedulePreview | null> {
  const sequence = db.sequences.find((s) => s.id === id);
  if (!sequence) return null;
  const campaigns = db.campaigns
    .filter((c) => c.sequence_id === id)
    .map((c) => ({ id: c.id, name: c.name, status: c.status }));
  const blockers = campaigns
    .filter((c) => c.status === 'active')
    .map((c) => `Pause campaign ${c.name} before applying the schedule.`);
  if (
    JSON.stringify(proposal.steps.map((s) => s.step_no).sort((a, b) => a - b)) !==
    JSON.stringify(sequence.steps.map((s) => s.step_no))
  )
    blockers.push('Include every step exactly once.');
  // Golden UI fixtures do not retain immutable accepted-send snapshots.
  if (campaigns.length)
    blockers.push(
      'Pending-date recalculation requires the real backend and accepted-send evidence.',
    );
  const bytes = new TextEncoder().encode(JSON.stringify({ sequence, campaigns, proposal }));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const fingerprint = [...new Uint8Array(digest)]
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('');
  return { fingerprint, campaigns, rows: [], blockers, can_apply: blockers.length === 0 };
}
export const sequenceScheduleHandlers = [
  http.post('/api/v1/sequences/:id/schedule/preview', async ({ params, request }) => {
    if (!db.authenticated)
      return HttpResponse.json(
        { error: { code: 'unauthorized', message: 'Sign in' } },
        { status: 401 },
      );
    const body = scheduleProposalSchema.safeParse(await request.json());
    if (!body.success)
      return HttpResponse.json(
        { error: { code: 'validation', message: 'Invalid timing' } },
        { status: 400 },
      );
    const result = await preview(Number(params.id), body.data);
    return result
      ? HttpResponse.json(result)
      : HttpResponse.json(
          { error: { code: 'not_found', message: 'Sequence missing' } },
          { status: 404 },
        );
  }),
  http.post('/api/v1/sequences/:id/schedule/apply', async ({ params, request }) => {
    if (!db.authenticated)
      return HttpResponse.json(
        { error: { code: 'unauthorized', message: 'Sign in' } },
        { status: 401 },
      );
    const body = scheduleApplyBodySchema.safeParse(await request.json());
    if (!body.success)
      return HttpResponse.json(
        { error: { code: 'validation', message: 'Invalid timing' } },
        { status: 400 },
      );
    const id = Number(params.id);
    const proposal = { wait_day_mode: body.data.wait_day_mode, steps: body.data.steps };
    const previous = receipts.get(body.data.operation_id);
    const p = await preview(id, proposal);
    if (!p)
      return HttpResponse.json(
        { error: { code: 'not_found', message: 'Sequence missing' } },
        { status: 404 },
      );
    if (
      previous
        ? previous.id !== id ||
          previous.fingerprint !== body.data.fingerprint ||
          JSON.stringify(previous.proposal) !== JSON.stringify(proposal)
        : !p.can_apply || p.fingerprint !== body.data.fingerprint
    )
      return HttpResponse.json(
        { error: { code: 'conflict', message: 'Preview again; campaigns must be paused.' } },
        { status: 409 },
      );
    const sequence = db.sequences.find((s) => s.id === id)!;
    if (!previous) {
      sequence.wait_day_mode = proposal.wait_day_mode;
      for (const step of sequence.steps)
        Object.assign(
          step,
          proposal.steps.find((s) => s.step_no === step.step_no),
        );
      receipts.set(body.data.operation_id, { id, fingerprint: body.data.fingerprint, proposal });
    }
    return HttpResponse.json({ sequence, changed: 0 });
  }),
];
