import type { Clock } from './index';

/** Production clock: wall time. */
export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}
