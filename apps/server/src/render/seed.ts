// Spintax seeding (docs/08 §2): seed = fnv1a(enrollmentId ':' stepNo ':' variantId)
// → one deterministic RNG stream per send, so a soft-bounce retry of the same
// send renders IDENTICALLY and tests are reproducible.
import { seededRng, type Rng } from '../util/rng';

/** FNV-1a 32-bit — tiny, stable, good spread for short keys. */
export function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function spintaxRng(enrollmentId: number, stepNo: number, variantId: number): Rng {
  return seededRng(fnv1a(`${enrollmentId}:${stepNo}:${variantId}`));
}
