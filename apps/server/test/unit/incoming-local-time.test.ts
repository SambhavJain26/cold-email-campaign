import { it, expect } from 'vitest';
import { resolveReviewLocalTime } from '@coldemail/shared';
it('resolves a normal IANA local time and rejects both daylight-saving gaps and repeated times', () => {
  expect(resolveReviewLocalTime('2026-10-12T10:00', 'America/New_York').instant).toBe(
    '2026-10-12T14:00:00.000Z',
  );
  expect(resolveReviewLocalTime('2026-03-08T02:30', 'America/New_York').instant).toBeNull();
  expect(resolveReviewLocalTime('2026-11-01T01:30', 'America/New_York').instant).toBeNull();
  expect(resolveReviewLocalTime('2026-10-12T10:00', 'Invalid/Zone').instant).toBeNull();
});
