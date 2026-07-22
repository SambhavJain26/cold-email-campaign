import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: [
            'apps/server/test/unit/**/*.test.ts',
            'apps/server/src/**/*.test.ts',
            'packages/shared/src/**/*.test.ts',
          ],
        },
      },
      {
        test: {
          name: 'integration',
          include: ['apps/server/test/integration/**/*.test.ts'],
          globalSetup: ['./apps/server/test/helpers/global-setup.ts'],
          // DB-backed tests share one database - keep them serial.
          fileParallelism: false,
        },
      },
      {
        test: {
          // The locked regression (docs/13 §3). NEVER skip - red here means
          // the math stopped closing. Separate required CI job.
          name: 'golden',
          include: ['apps/server/test/golden/**/*.test.ts'],
          globalSetup: ['./apps/server/test/helpers/global-setup.ts'],
          fileParallelism: false,
          testTimeout: 120_000,
        },
      },
    ],
  },
});
