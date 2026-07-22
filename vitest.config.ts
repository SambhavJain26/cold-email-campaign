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
          // DB-backed tests share one database - keep them serial for now
          // (per-schema isolation arrives with real tables in B1).
          fileParallelism: false,
        },
      },
    ],
  },
});
