import { durationMs, type Duration, type SteppableClock } from './index';

// Re-exported for existing importers; the definitions live in the barrel so
// interface-only consumers (SimulationDriver) never touch this file.
export { durationMs };
export type { Duration };

/**
 * Test clock: time moves only when told to. Drives multi-day scenario tests
 * in milliseconds (docs/13 §4). stepTo() is the tick-stepping primitive the
 * scenario runner builds on: it advances in fixed increments, invoking a
 * callback at each step - exactly how scheduler ticks + poll cycles fire
 * "along the way" of a time jump.
 */
export class VirtualClock implements SteppableClock {
  private current: Date;

  constructor(start: Date | string = '2026-01-05T08:00:00Z') {
    this.current = new Date(start);
  }

  now(): Date {
    return new Date(this.current);
  }

  set(to: Date | string): void {
    const next = new Date(to);
    if (next.getTime() < this.current.getTime()) {
      throw new Error(
        `VirtualClock cannot move backwards (${this.current.toISOString()} -> ${next.toISOString()})`,
      );
    }
    this.current = next;
  }

  advance(d: Duration): Date {
    this.current = new Date(this.current.getTime() + durationMs(d));
    return this.now();
  }

  /**
   * Advance to `target` in `step` increments, awaiting `onStep(now)` after each.
   * The final step lands exactly on `target` even if not step-aligned.
   */
  async stepTo(
    target: Date | string,
    step: Duration,
    onStep: (now: Date) => void | Promise<void>,
  ): Promise<void> {
    const end = new Date(target).getTime();
    if (end < this.current.getTime()) {
      throw new Error('VirtualClock.stepTo target is in the past');
    }
    const stepMs = durationMs(step);
    if (stepMs <= 0) throw new Error('VirtualClock.stepTo step must be positive');
    while (this.current.getTime() < end) {
      this.current = new Date(Math.min(this.current.getTime() + stepMs, end));
      await onStep(this.now());
    }
  }
}
