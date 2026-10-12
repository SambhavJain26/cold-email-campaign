import { describe, expect, it } from 'vitest';
import { followupDueAt } from '../../src/scheduler/followupDue';
import { resolveTimezone } from '../../src/scheduler/tzmap';

describe('business-day follow-up eligibility', () => {
  it('counts the corrected Tuesday five-email schedule at weekday midnight', () => {
    let accepted = new Date('2026-10-06T18:00:00Z'); // Tuesday 2 PM New York
    const targets = [
      '2026-10-09T04:00:00.000Z',
      '2026-10-29T04:00:00.000Z',
      '2026-11-04T05:00:00.000Z',
      '2026-11-10T05:00:00.000Z',
    ];
    for (const [index, days] of [3, 14, 4, 4].entries()) {
      const due = followupDueAt(accepted, days, 'business_days', 'America/New_York');
      expect(due.toISOString()).toBe(targets[index]);
      accepted = new Date(due.getTime() + 14 * 3600000); // actual send that afternoon
    }
  });
  it.each([
    ['2026-10-09T18:00:00Z', 1, '2026-10-12T04:00:00.000Z'], // Friday
    ['2026-10-10T18:00:00Z', 1, '2026-10-12T04:00:00.000Z'], // Saturday
    ['2026-10-11T18:00:00Z', 1, '2026-10-12T04:00:00.000Z'], // Sunday
    ['2026-12-31T19:00:00Z', 1, '2027-01-01T05:00:00.000Z'], // holidays count
    ['2026-03-06T19:00:00Z', 1, '2026-03-09T04:00:00.000Z'], // spring DST
    ['2026-10-30T18:00:00Z', 1, '2026-11-02T05:00:00.000Z'], // autumn DST
  ])('counts weekdays across boundaries from %s', (sent, days, expected) => {
    expect(
      followupDueAt(new Date(sent), days, 'business_days', 'America/New_York').toISOString(),
    ).toBe(expected);
  });
  it('uses recipient timezone with mailbox fallback', () => {
    const sent = new Date('2026-10-10T02:00:00Z'); // Friday west coast; Saturday UTC
    expect(
      followupDueAt(sent, 1, 'business_days', resolveTimezone('CA', 'UTC')).toISOString(),
    ).toBe('2026-10-12T07:00:00.000Z');
    expect(resolveTimezone(null, 'America/New_York')).toBe('America/New_York');
  });
  it('preserves zero wait and exact legacy elapsed waits including milliseconds', () => {
    const sent = new Date('2026-10-09T18:00:00.123Z');
    expect(followupDueAt(sent, 0, 'business_days', 'UTC')).toEqual(sent);
    expect(followupDueAt(sent, 3, 'business_days', 'America/New_York').toISOString()).toBe(
      '2026-10-14T04:00:00.000Z',
    );
    expect(followupDueAt(sent, 3, 'elapsed_days', 'America/New_York').toISOString()).toBe(
      '2026-10-12T18:00:00.123Z',
    );
    expect(() => followupDueAt(sent, -1, 'business_days', 'UTC')).toThrow();
  });
});
