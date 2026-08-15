// Hard launch guardrails (docs/16 §8 item 2, migration 0011).
//
// These bound what an operator can CONFIGURE, not what the system can do. The
// failure they exist to prevent is mundane and expensive: a mistyped daily cap
// or a missing ramp turning a first real campaign into a volume spike that
// burns a freshly-warmed domain on day one.
//
// What they are NOT: a substitute for warming, for recipient consent, or for
// domain authentication. A configuration inside these ceilings is *permitted*,
// never *safe* — safety is the preflight's job (docs/16 §8 item 3) and the
// operator's.
//
// Pure by construction so the policy is unit-testable without a database; the
// routes load the limits and turn a message into a 422.

export interface LaunchLimits {
  maxMailboxDailyCap: number;
  maxRampDailyEnrollCap: number;
  /** 0 = staged enrollment not enforced (the migration default). */
  minRampDays: number;
}

export interface RampShape {
  ramp_days: number;
  ramp_daily_enroll_cap: number;
}

/** Message describing the violation, or null when the value is permitted. */
export function checkMailboxDailyCap(
  dailyCap: number | undefined,
  limits: LaunchLimits,
): string | null {
  if (dailyCap === undefined) return null;
  if (dailyCap <= limits.maxMailboxDailyCap) return null;
  return (
    `daily_cap ${dailyCap} exceeds the launch guardrail of ${limits.maxMailboxDailyCap}. ` +
    `Raise max_mailbox_daily_cap in Settings if the mailbox is genuinely warmed for that volume.`
  );
}

export function checkRamp(ramp: RampShape | undefined, limits: LaunchLimits): string | null {
  if (ramp === undefined) return null;
  if (ramp.ramp_daily_enroll_cap > limits.maxRampDailyEnrollCap) {
    return (
      `ramp_daily_enroll_cap ${ramp.ramp_daily_enroll_cap} exceeds the launch guardrail of ` +
      `${limits.maxRampDailyEnrollCap}. Raise max_ramp_daily_enroll_cap in Settings to allow it.`
    );
  }
  // minRampDays 0 disables the staged-enrollment requirement entirely, which
  // is the default so this cannot invalidate campaigns created before 0011.
  if (limits.minRampDays > 0 && ramp.ramp_days < limits.minRampDays) {
    return (
      `ramp_days ${ramp.ramp_days} is below the required staged-enrollment window of ` +
      `${limits.minRampDays} days. Lower min_ramp_days in Settings to allow a shorter ramp.`
    );
  }
  return null;
}
