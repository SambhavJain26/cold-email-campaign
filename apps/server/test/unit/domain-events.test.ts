import { describe, expect, it } from 'vitest';
import { buildEvent, parseDomainEvent } from '../../src/domain/events';

const at = new Date('2026-03-01T10:00:00Z');
const ids = { leadId: 1, enrollmentId: 2, campaignId: 3 };

describe('event constructors', () => {
  it('builds a sent event with required content_hash', () => {
    const e = buildEvent.sent({
      ...ids,
      occurredAt: at,
      stepNo: 1,
      mailboxId: 4,
      messageId: '<m1@x>',
      attributes: { content_hash: 'abc' },
    });
    expect(e.type).toBe('sent');
    expect(e.attributes.content_hash).toBe('abc');
  });

  it('rejects a sent event without content_hash (decision Q guard)', () => {
    expect(() =>
      buildEvent.sent({
        ...ids,
        occurredAt: at,
        stepNo: 1,
        mailboxId: 4,
        messageId: '<m1@x>',
        // @ts-expect-error missing content_hash
        attributes: {},
      }),
    ).toThrow();
  });

  it('human_reply sentiment defaults to null (decision M: null until tagged)', () => {
    const e = buildEvent.humanReply({ ...ids, occurredAt: at, stepNo: 2 });
    expect(e.sentiment).toBeNull();
  });

  it('sentiment_tagged requires reply_event_id and tagged_by human', () => {
    const e = buildEvent.sentimentTagged({
      ...ids,
      occurredAt: at,
      sentiment: 'neutral',
      attributes: { reply_event_id: 99, tagged_by: 'human' },
    });
    expect(e.attributes.reply_event_id).toBe(99);
    expect(() =>
      buildEvent.sentimentTagged({
        ...ids,
        occurredAt: at,
        sentiment: 'neutral',
        // @ts-expect-error missing reply_event_id
        attributes: { tagged_by: 'human' },
      }),
    ).toThrow();
  });

  it('soft_bounce requires retry_no', () => {
    expect(() =>
      buildEvent.softBounce({
        ...ids,
        occurredAt: at,
        stepNo: 1,
        // @ts-expect-error missing retry_no
        attributes: {},
      }),
    ).toThrow();
  });

  it('unsubscribe requires a valid source', () => {
    const e = buildEvent.unsubscribe({ ...ids, occurredAt: at, source: 'reply' });
    expect(e.source).toBe('reply');
  });

  it('parseDomainEvent round-trips a constructed event', () => {
    const e = buildEvent.meetingBooked({ ...ids, occurredAt: at });
    expect(parseDomainEvent(e)).toEqual(e);
  });

  it('parseDomainEvent rejects unknown types', () => {
    expect(() => parseDomainEvent({ type: 'opened', occurredAt: at, leadId: 1 })).toThrow();
  });
});
