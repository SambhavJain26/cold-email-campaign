// docs/06 §6: telling "the provider is throttling us" apart from "SMTP is
// flaky". The first is provider_blocked (+ redistribution), the second is a
// plain pause — so the matcher has to be right about real provider strings.
import { describe, expect, it } from 'vitest';
import {
  TRANSIENT_FAILURE_LIMIT,
  isRateLimitError,
  transientVerdict,
} from '../../src/scheduler/providerBlock';

describe('isRateLimitError (B8 / docs/06 §6)', () => {
  it('matches the throttling answers real providers send', () => {
    const throttles = [
      '421 4.7.0 Try again later, closing connection',
      '421 4.7.0 [TSS04] Messages per second exceeded',
      '450 4.2.1 The user you are trying to contact is receiving mail at a rate that prevents additional messages',
      '451 4.7.500 Server busy, please try again later',
      '452 4.5.3 Too many recipients',
      '550 5.4.5 Daily user sending limit exceeded',
      'Request was throttled by the provider',
      '454 4.7.0 Too many login attempts',
    ];
    for (const text of throttles) {
      expect(isRateLimitError(text), text).toBe(true);
    }
  });

  it('does NOT match ordinary transient failures', () => {
    const ordinary = [
      '451 4.3.0 Temporary system problem',
      'connection closed by remote host',
      'ECONNRESET',
      '450 4.1.1 Recipient address rejected: user unknown',
    ];
    for (const text of ordinary) {
      expect(isRateLimitError(text), text).toBe(false);
    }
    expect(isRateLimitError(undefined)).toBe(false);
    expect(isRateLimitError('')).toBe(false);
  });

  it('treats a bare 421 as throttling — the code means "go away for now"', () => {
    expect(isRateLimitError('421 service unavailable')).toBe(true);
  });
});

describe('transientVerdict', () => {
  it('keeps retrying below the limit, whatever the failures look like', () => {
    for (let n = 1; n < TRANSIENT_FAILURE_LIMIT; n++) {
      expect(transientVerdict(n, n)).toBe('keep_retrying');
      expect(transientVerdict(n, 0)).toBe('keep_retrying');
    }
  });

  it('an unbroken run of rate limits blocks; anything else just pauses', () => {
    expect(transientVerdict(TRANSIENT_FAILURE_LIMIT, TRANSIENT_FAILURE_LIMIT)).toBe(
      'provider_blocked',
    );
    // One non-rate-limit failure in the run resets the counter → smtp_failing.
    expect(transientVerdict(TRANSIENT_FAILURE_LIMIT, TRANSIENT_FAILURE_LIMIT - 1)).toBe(
      'smtp_failing',
    );
    expect(transientVerdict(TRANSIENT_FAILURE_LIMIT, 0)).toBe('smtp_failing');
  });
});
