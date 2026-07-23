// Decision H lockstep: the shared package's error-code enum IS the server's
// closed set — a drift here means docs/10, packages/shared, and api/errors.ts
// stopped agreeing.
import { describe, expect, it } from 'vitest';
import { API_ERROR_CODES } from '@coldemail/shared';
import { ERROR_CODES } from '../../src/api/errors';

describe('error-code lockstep (decision H / Z)', () => {
  it('shared enum equals the server closed set, order included', () => {
    expect([...API_ERROR_CODES]).toEqual([...ERROR_CODES]);
  });
});
