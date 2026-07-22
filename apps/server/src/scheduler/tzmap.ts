// Timezone resolution (decision X, docs/06 §4): static US state → IANA map.
// Split states are mapped to their MAJORITY zone (noted inline). Unknown or
// missing state → the caller falls back to settings.default_timezone -
// unknown NEVER means send-now (spec Part 7).

export const STATE_TZ: Record<string, string> = {
  // Eastern
  CT: 'America/New_York',
  DC: 'America/New_York',
  DE: 'America/New_York',
  FL: 'America/New_York', // split; panhandle is Central - majority Eastern
  GA: 'America/New_York',
  IN: 'America/New_York', // split; majority Eastern
  KY: 'America/New_York', // split; majority Eastern
  MA: 'America/New_York',
  MD: 'America/New_York',
  ME: 'America/New_York',
  MI: 'America/New_York', // split; majority Eastern
  NC: 'America/New_York',
  NH: 'America/New_York',
  NJ: 'America/New_York',
  NY: 'America/New_York',
  OH: 'America/New_York',
  PA: 'America/New_York',
  RI: 'America/New_York',
  SC: 'America/New_York',
  VA: 'America/New_York',
  VT: 'America/New_York',
  WV: 'America/New_York',
  // Central
  AL: 'America/Chicago',
  AR: 'America/Chicago',
  IA: 'America/Chicago',
  IL: 'America/Chicago',
  KS: 'America/Chicago', // split; majority Central
  LA: 'America/Chicago',
  MN: 'America/Chicago',
  MO: 'America/Chicago',
  MS: 'America/Chicago',
  ND: 'America/Chicago', // split; majority Central
  NE: 'America/Chicago', // split; majority Central
  OK: 'America/Chicago',
  SD: 'America/Chicago', // split; majority Central
  TN: 'America/Chicago', // split; majority Central
  TX: 'America/Chicago', // split; majority Central
  WI: 'America/Chicago',
  // Mountain
  CO: 'America/Denver',
  ID: 'America/Denver', // split; majority Mountain
  MT: 'America/Denver',
  NM: 'America/Denver',
  UT: 'America/Denver',
  WY: 'America/Denver',
  AZ: 'America/Phoenix', // no DST
  // Pacific
  CA: 'America/Los_Angeles',
  NV: 'America/Los_Angeles', // split; majority Pacific
  OR: 'America/Los_Angeles', // split; majority Pacific
  WA: 'America/Los_Angeles',
  // Off-mainland
  AK: 'America/Anchorage',
  HI: 'Pacific/Honolulu',
};

/** `leads.state` → IANA zone; null/unknown → defaultTimezone (never send-now). */
export function resolveTimezone(state: string | null | undefined, defaultTimezone: string): string {
  if (!state) return defaultTimezone;
  return STATE_TZ[state.trim().toUpperCase()] ?? defaultTimezone;
}
