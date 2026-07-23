// The Clock seam (build_plan §3.4): ALL time reads go through this interface.
// This barrel exports ONLY interfaces — concrete clocks (system.ts,
// virtual.ts) are imported solely by composition.ts and tests, enforced by
// ESLint boundary rules.

export interface Clock {
  now(): Date;
}

export interface Duration {
  days?: number;
  hours?: number;
  minutes?: number;
  seconds?: number;
  ms?: number;
}

export function durationMs(d: Duration): number {
  return (
    (d.days ?? 0) * 86_400_000 +
    (d.hours ?? 0) * 3_600_000 +
    (d.minutes ?? 0) * 60_000 +
    (d.seconds ?? 0) * 1_000 +
    (d.ms ?? 0)
  );
}

/**
 * A clock that can be driven forward (VirtualClock implements this). The
 * SimulationDriver (B6.12) depends on THIS interface, not the concrete —
 * keeping the concrete-clock ESLint ban intact.
 */
export interface SteppableClock extends Clock {
  advance(d: Duration): Date;
  stepTo(
    target: Date | string,
    step: Duration,
    onStep: (now: Date) => void | Promise<void>,
  ): Promise<void>;
}

export function isSteppable(clock: Clock): clock is SteppableClock {
  return 'stepTo' in clock && 'advance' in clock;
}
