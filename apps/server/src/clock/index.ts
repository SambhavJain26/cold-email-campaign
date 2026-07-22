// The Clock seam (build_plan §3.4): ALL time reads go through this interface.
// This barrel exports ONLY the interface - concrete clocks (system.ts,
// virtual.ts) are imported solely by composition.ts and tests, enforced by
// ESLint boundary rules.

export interface Clock {
  now(): Date;
}
