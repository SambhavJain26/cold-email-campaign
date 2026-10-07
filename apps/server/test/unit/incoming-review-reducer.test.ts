import { describe, it, expect } from 'vitest';
import { buildEvent } from '../../src/domain/events';
import { applyEvent, foldEvents } from '../../src/domain/reducer';
const base = {
  leadId: 1,
  enrollmentId: 1,
  campaignId: 1,
  occurredAt: new Date('2026-10-08T12:00:00Z'),
};
const shape = { lastStepNo: 5, softRetryMax: 2 };
const start = foldEvents(
  [
    buildEvent.enrolled(base),
    buildEvent.sent({
      ...base,
      id: 2,
      mailboxId: 1,
      stepNo: 1,
      messageId: '<first@test>',
      attributes: { content_hash: 'first' },
    }),
  ],
  shape,
);
describe('incoming review state is independent of response authorship', () => {
  it('holds without losing progress and only resolves named holds', () => {
    const held = applyEvent(
      start,
      buildEvent.reviewRequired({ ...base, id: 3, attributes: { incoming_message_id: 10 } }),
      shape,
    );
    const newer = applyEvent(
      held,
      buildEvent.reviewRequired({ ...base, id: 4, attributes: { incoming_message_id: 11 } }),
      shape,
    );
    const continued = applyEvent(
      newer,
      buildEvent.reviewDecided({
        ...base,
        id: 5,
        attributes: { action: 'continue', hold_event_ids: [3], operation_id: 'one' },
      }),
      shape,
    );
    expect(continued.state).toBe('ACTIVE');
    expect(continued.currentStepNo).toBe(2);
    expect(continued.reviewHoldIds).toEqual([4]);
  });
  it('human confirmation never makes the sequence terminal', () => {
    const confirmed = applyEvent(
      start,
      buildEvent.authorshipConfirmed({
        ...base,
        id: 3,
        attributes: { incoming_message_id: 10, authorship: 'human', operation_id: 'one' },
      }),
      shape,
    );
    expect(confirmed.state).toBe('ACTIVE');
    expect(confirmed.currentStepNo).toBe(2);
  });
  it('manual stop checkpoint restores to hold and does not suppress', () => {
    const stopped = applyEvent(
      start,
      buildEvent.sequenceStopped({
        ...base,
        id: 3,
        attributes: {
          hold_event_ids: [],
          resume_due_at: '2026-10-10T12:00:00Z',
          operation_id: 'one',
        },
      }),
      shape,
    );
    expect(stopped.state).toBe('STOPPED');
    const restored = applyEvent(
      stopped,
      buildEvent.sequenceRestored({
        ...base,
        id: 4,
        attributes: {
          blocker_event_ids: [3],
          reason: 'Operator correction',
          resume_due_at: '2026-10-10T12:00:00Z',
          operation_id: 'two',
        },
      }),
      shape,
    );
    expect(restored.state).toBe('ACTIVE');
    expect(restored.reviewHoldIds).toEqual([4]);
    expect(restored.currentStepNo).toBe(2);
  });
  it('restoration cannot undo unsubscribe or bounce', () => {
    const restored = buildEvent.sequenceRestored({
      ...base,
      id: 5,
      attributes: {
        blocker_event_ids: [3],
        reason: 'Mistake',
        resume_due_at: '2026-10-10T12:00:00Z',
        operation_id: 'one',
      },
    });
    for (const event of [
      buildEvent.unsubscribe({ ...base, source: 'reply' }),
      buildEvent.hardBounce({ ...base, stepNo: 1 }),
    ]) {
      const terminal = applyEvent(start, event, shape);
      expect(applyEvent(terminal, restored, shape)).toEqual(terminal);
    }
  });
});
