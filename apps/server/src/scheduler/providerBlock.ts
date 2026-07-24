// docs/06 §6: `ok ──(provider rate-limit persists)──▶ provider_blocked`.
//
// Transient SMTP failures are normal and are retried (4b). What distinguishes a
// BLOCK from ordinary flakiness is that the provider keeps answering with a
// rate-limit/throttle code: the mailbox isn't broken, the provider is refusing
// it for now - which is a different operator action (wait + resume) and, like
// auth_failed, warrants redistributing unstarted enrollments to other mailboxes.
//
// Pure so the pattern list is unit-testable against real provider strings.

/**
 * Rate-limit / throttling signals in an SMTP response line. Deliberately
 * narrow: anything not matched here stays a plain transient failure and ends in
 * `paused / smtp_failing`, which is the safer default.
 */
const RATE_LIMIT_PATTERNS: RegExp[] = [
  /\brate limit(ed|ing)?\b/i,
  /\bratelimit/i,
  /\bthrottl(e|ed|ing)\b/i,
  /\btoo many\b/i, // "too many messages", "too many connections", "too many login attempts"
  /\bquota (exceeded|reached)\b/i,
  /\bsending limit\b/i,
  /\bat a rate\b/i, // Gmail: "…receiving mail at a rate that prevents additional messages"
  /\bexceeded .*\b(limit|quota)\b/i,
  /\btry again later\b/i,
  /^\s*421\b/, // service not available, closing transmission channel
  /\b4\.7\.(0|1)\b/, // enhanced status: policy/rate related
  /\b4\.5\.3\b/, // too many recipients
];

export function isRateLimitError(error: string | undefined): boolean {
  if (!error) return false;
  return RATE_LIMIT_PATTERNS.some((re) => re.test(error));
}

/** Consecutive transient failures on one mailbox before it is taken out. */
export const TRANSIENT_FAILURE_LIMIT = 5;

/**
 * Which health state a run of consecutive transient failures resolves to.
 * `rateLimited` counts how many of those failures looked like a rate limit -
 * a clean run of them means the provider is blocking us, not that SMTP is sick.
 */
export function transientVerdict(
  failures: number,
  rateLimited: number,
): 'keep_retrying' | 'provider_blocked' | 'smtp_failing' {
  if (failures < TRANSIENT_FAILURE_LIMIT) return 'keep_retrying';
  return rateLimited >= TRANSIENT_FAILURE_LIMIT ? 'provider_blocked' : 'smtp_failing';
}
