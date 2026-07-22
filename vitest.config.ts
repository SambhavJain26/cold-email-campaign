import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'apps/server/test/**/*.test.ts',
      'apps/server/src/**/*.test.ts',
      'packages/shared/src/**/*.test.ts',
    ],
    // DB-backed integration tests get a globalSetup in B0.4.
  },
});
