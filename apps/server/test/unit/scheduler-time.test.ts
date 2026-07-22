// B3.5: timezone resolution (decision X) + window math (docs/06 §4).
import { describe, expect, it } from 'vitest';
import { resolveTimezone, STATE_TZ } from '../../src/scheduler/tzmap';
import {
  insideWindow,
  localParts,
  parseHHMM,
  startOfLocalDay,
  windowMinutes,
} from '../../src/scheduler/window';
import type { SendWindow } from '../../src/db/schema/transport';

const DEFAULT_TZ = 'America/New_York';
const weekdays: SendWindow = { days: [1, 2, 3, 4, 5], start: '08:00', end: '17:00' };

describe('resolveTimezone (decision X)', () => {
  it('maps state codes to IANA zones, case/space-insensitively', () => {
    expect(resolveTimezone('TX', DEFAULT_TZ)).toBe('America/Chicago');
    expect(resolveTimezone('ca', DEFAULT_TZ)).toBe('America/Los_Angeles');
    expect(resolveTimezone(' ny ', DEFAULT_TZ)).toBe('America/New_York');
    expect(resolveTimezone('AZ', DEFAULT_TZ)).toBe('America/Phoenix');
    expect(resolveTimezone('HI', DEFAULT_TZ)).toBe('Pacific/Honolulu');
  });

  it('split states map to their majority zone', () => {
    expect(resolveTimezone('TN', DEFAULT_TZ)).toBe('America/Chicago');
    expect(resolveTimezone('KY', DEFAULT_TZ)).toBe('America/New_York');
    expect(resolveTimezone('ID', DEFAULT_TZ)).toBe('America/Denver');
  });

  it('unknown or missing state falls back to the default — never send-now', () => {
    expect(resolveTimezone(null, DEFAULT_TZ)).toBe(DEFAULT_TZ);
    expect(resolveTimezone(undefined, DEFAULT_TZ)).toBe(DEFAULT_TZ);
    expect(resolveTimezone('ZZ', DEFAULT_TZ)).toBe(DEFAULT_TZ);
    expect(resolveTimezone('', DEFAULT_TZ)).toBe(DEFAULT_TZ);
  });

  it('covers all 50 states + DC', () => {
    expect(Object.keys(STATE_TZ)).toHaveLength(51);
  });
});

describe('insideWindow (docs/06 §4)', () => {
  // 2026-01-05 is a Monday. 14:00Z = 09:00 ET = 08:00 CT = 06:00 PT.
  const mon14z = new Date('2026-01-05T14:00:00Z');

  it('window is evaluated in the RECIPIENT zone', () => {
    expect(insideWindow(weekdays, mon14z, 'America/New_York')).toBe(true); // 09:00
    expect(insideWindow(weekdays, mon14z, 'America/Chicago')).toBe(true); // 08:00 — inclusive start
    expect(insideWindow(weekdays, mon14z, 'America/Denver')).toBe(false); // 07:00
    expect(insideWindow(weekdays, mon14z, 'America/Los_Angeles')).toBe(false); // 06:00
  });

  it('end is exclusive, start inclusive', () => {
    const et1659 = new Date('2026-01-05T21:59:00Z'); // 16:59 ET
    const et1700 = new Date('2026-01-05T22:00:00Z'); // 17:00 ET
    expect(insideWindow(weekdays, et1659, 'America/New_York')).toBe(true);
    expect(insideWindow(weekdays, et1700, 'America/New_York')).toBe(false);
  });

  it('day-of-week respects the recipient zone (Sat excluded on weekday window)', () => {
    const sat = new Date('2026-01-10T15:00:00Z'); // Saturday everywhere
    expect(insideWindow(weekdays, sat, 'America/New_York')).toBe(false);
    const allDays: SendWindow = { ...weekdays, days: [1, 2, 3, 4, 5, 6, 7] };
    expect(insideWindow(allDays, sat, 'America/New_York')).toBe(true);
  });

  it('Sunday-late-UTC is Monday in no US zone: weekday gate uses local day', () => {
    // 2026-01-06T01:00Z is Mon 01:00 UTC but still Sun 20:00 ET — outside hours anyway;
    // check the day flip: Tue 00:30Z = Mon 19:30 ET -> Monday locally.
    const p = localParts(new Date('2026-01-06T00:30:00Z'), 'America/New_York');
    expect(p.isoWeekday).toBe(1); // Monday
  });
});

describe('startOfLocalDay — the cap-reset anchor (no reset cron)', () => {
  it('returns the UTC instant of local midnight', () => {
    const now = new Date('2026-01-05T14:00:00Z'); // 09:00 ET
    expect(startOfLocalDay(now, 'America/New_York').toISOString()).toBe('2026-01-05T05:00:00.000Z');
    expect(startOfLocalDay(now, 'America/Chicago').toISOString()).toBe('2026-01-05T06:00:00.000Z');
  });

  it('early-UTC hours belong to the PREVIOUS local day', () => {
    const now = new Date('2026-01-05T03:00:00Z'); // Sun 22:00 ET (Jan 4)
    expect(startOfLocalDay(now, 'America/New_York').toISOString()).toBe('2026-01-04T05:00:00.000Z');
  });

  it('handles the spring-forward DST day (EDT starts 2026-03-08)', () => {
    const now = new Date('2026-03-08T15:00:00Z'); // 11:00 EDT
    expect(startOfLocalDay(now, 'America/New_York').toISOString()).toBe(
      '2026-03-08T05:00:00.000Z', // midnight was still EST (UTC-5)
    );
  });
});

describe('window arithmetic', () => {
  it('parseHHMM and windowMinutes', () => {
    expect(parseHHMM('08:00')).toBe(480);
    expect(parseHHMM('17:00')).toBe(1020);
    expect(windowMinutes(weekdays)).toBe(540);
  });
});
