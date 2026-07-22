import { describe, expect, it } from 'vitest';
import {
  mailboxImbalance,
  replyRateDrop,
  unsubClimbing,
} from '../../src/services/metrics/watchRules';
import type { DailySeriesRow, MailboxVolumeRow } from '../../src/db/repos/metricsRepo';

const day = (i: number, over: Partial<Omit<DailySeriesRow, 'day'>> = {}): DailySeriesRow => ({
  day: `2026-02-${String(i + 1).padStart(2, '0')}`,
  sent: 100,
  delivered: 95,
  replies: 5,
  hard_bounces: 0,
  unsubscribes: 0,
  ...over,
});

describe('replyRateDrop', () => {
  it('flags a >30% drop between window halves', () => {
    const series = [
      ...Array.from({ length: 10 }, (_, i) => day(i, { replies: 8 })), // ~8.4%
      ...Array.from({ length: 10 }, (_, i) => day(i + 10, { replies: 3 })), // ~3.2%
    ];
    expect(replyRateDrop(series)?.rule).toBe('reply_rate_drop');
  });

  it('stays silent on stable rates and on low volume', () => {
    const stable = Array.from({ length: 20 }, (_, i) => day(i));
    expect(replyRateDrop(stable)).toBeNull();
    const tiny = Array.from({ length: 20 }, (_, i) =>
      day(i, { delivered: 3, replies: i < 10 ? 1 : 0 }),
    );
    expect(replyRateDrop(tiny)).toBeNull(); // < 50 delivered per half
  });
});

describe('unsubClimbing', () => {
  it('flags a rising 14-day unsubscribe trend', () => {
    const series = Array.from({ length: 14 }, (_, i) => day(i, { unsubscribes: i < 7 ? 0 : 2 }));
    expect(unsubClimbing(series)?.rule).toBe('unsub_rate_climbing');
  });

  it('ignores flat trends and noise-floor totals', () => {
    const flat = Array.from({ length: 14 }, (_, i) => day(i, { unsubscribes: 1 }));
    expect(unsubClimbing(flat)).toBeNull();
    const sparse = Array.from({ length: 14 }, (_, i) => day(i, { unsubscribes: i === 13 ? 2 : 0 })); // total 2 < 5
    expect(unsubClimbing(sparse)).toBeNull();
  });
});

describe('mailboxImbalance', () => {
  const vol = (mailboxId: number, sends: number[]): MailboxVolumeRow[] =>
    sends.map((s, i) => ({
      mailbox_id: mailboxId,
      day: `2026-02-${String(i + 1).padStart(2, '0')}`,
      sends: s,
    }));

  it('flags one mailbox running >1.5x hotter', () => {
    const { flag, sevenDayAvg } = mailboxImbalance([
      ...vol(1, [30, 30, 30, 30, 30, 30, 30]),
      ...vol(2, [18, 18, 18, 18, 18, 18, 18]),
    ]);
    expect(flag?.rule).toBe('mailbox_imbalance');
    expect(sevenDayAvg[1]).toBe(30);
    expect(sevenDayAvg[2]).toBe(18);
  });

  it('stays silent when balanced', () => {
    const { flag } = mailboxImbalance([
      ...vol(1, [28, 30, 27, 29, 30, 28, 30]),
      ...vol(2, [30, 29, 30, 28, 27, 30, 29]),
    ]);
    expect(flag).toBeNull();
  });
});
