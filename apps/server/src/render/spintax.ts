// Spintax picks (docs/08 §2): uniform choice per tag per render, driven by
// the seeded stream from seed.ts — subject tokens consume the stream first,
// then body, in document order (engine.ts guarantees the order).
import type { Rng } from '../util/rng';

/** Uniform pick bound to the send's seeded RNG stream. */
export function seededPick(rng: Rng): (options: string[]) => string {
  return (options) => options[Math.floor(rng() * options.length)]!;
}

/** Longest option — used for the check #7 longest-branch subject length. */
export function longestPick(options: string[]): string {
  return options.reduce((a, b) => (b.length > a.length ? b : a), '');
}
