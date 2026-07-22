// Seeded PRNG seam (docs/13 §4): all runtime randomness (send jitter,
// rotation tie-breaks, later spintax) flows through an injected Rng so
// scenario tests are fully deterministic from one seed.

/** Uniform [0, 1) - same contract as Math.random. */
export type Rng = () => number;

export const systemRng: Rng = Math.random;

/** mulberry32 - tiny, fast, good-enough distribution for pacing jitter. */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
