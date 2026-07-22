// Smoke test: workspace linking + test runner wiring. Replaced by real suites from B1 on.
import { describe, expect, it } from 'vitest';
import { SHARED_PACKAGE_NAME } from '@coldemail/shared';

describe('scaffold', () => {
  it('resolves the shared workspace package', () => {
    expect(SHARED_PACKAGE_NAME).toBe('@coldemail/shared');
  });
});
