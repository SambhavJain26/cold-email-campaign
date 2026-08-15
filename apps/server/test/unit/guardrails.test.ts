// Launch guardrails (0011, docs/16 §8 item 2). The policy is pure, so the
// interesting cases are the boundaries and the deliberate escape hatches.
import { describe, expect, it } from 'vitest';
import { checkMailboxDailyCap, checkRamp, type LaunchLimits } from '../../src/services/guardrails';

const LIMITS: LaunchLimits = {
  maxMailboxDailyCap: 50,
  maxRampDailyEnrollCap: 25,
  minRampDays: 7,
};

describe('mailbox daily cap ceiling', () => {
  it('permits a value at the ceiling', () => {
    expect(checkMailboxDailyCap(50, LIMITS)).toBeNull();
  });

  it('refuses one above it and names the setting that would allow it', () => {
    const msg = checkMailboxDailyCap(51, LIMITS);
    expect(msg).toContain('exceeds the launch guardrail of 50');
    expect(msg).toContain('max_mailbox_daily_cap');
  });

  it('ignores an omitted cap — a PATCH that does not touch it is unaffected', () => {
    expect(checkMailboxDailyCap(undefined, LIMITS)).toBeNull();
  });
});

describe('campaign ramp ceiling', () => {
  it('permits a ramp at both boundaries', () => {
    expect(checkRamp({ ramp_days: 7, ramp_daily_enroll_cap: 25 }, LIMITS)).toBeNull();
  });

  it('refuses an enroll cap above the ceiling', () => {
    expect(checkRamp({ ramp_days: 7, ramp_daily_enroll_cap: 26 }, LIMITS)).toContain(
      'max_ramp_daily_enroll_cap',
    );
  });

  it('refuses a ramp shorter than the required staged-enrollment window', () => {
    expect(checkRamp({ ramp_days: 6, ramp_daily_enroll_cap: 10 }, LIMITS)).toContain(
      'below the required staged-enrollment window of 7 days',
    );
  });

  it('reports the enroll-cap violation first when both are wrong', () => {
    // Volume is the dangerous half; the operator should see that first.
    expect(checkRamp({ ramp_days: 0, ramp_daily_enroll_cap: 999 }, LIMITS)).toContain(
      'ramp_daily_enroll_cap',
    );
  });

  it('min_ramp_days = 0 disables the staged-enrollment requirement entirely', () => {
    // This is the migration default, so 0011 cannot retroactively invalidate
    // campaigns created before it — including every existing test fixture.
    const off = { ...LIMITS, minRampDays: 0 };
    expect(checkRamp({ ramp_days: 0, ramp_daily_enroll_cap: 20 }, off)).toBeNull();
  });

  it('ignores an omitted ramp — creation falls back to the column default', () => {
    expect(checkRamp(undefined, LIMITS)).toBeNull();
  });
});
