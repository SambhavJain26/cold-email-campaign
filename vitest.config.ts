import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        // F0.6: web component tests — jsdom + Testing Library.
        resolve: {
          alias: { '@': path.resolve(import.meta.dirname, 'apps/web/src') },
        },
        test: {
          name: 'web',
          include: ['apps/web/src/**/*.test.{ts,tsx}'],
          environment: 'jsdom',
          setupFiles: ['./apps/web/src/test/setup.ts'],
        },
      },
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
          // DB-backed tests share one database — keep them serial.
          fileParallelism: false,
          // Multi-day VirtualClock scenarios run hundreds of real DB ticks;
          // the 5s default flakes on slower runs (B4 added per-tick queries).
          testTimeout: 30_000,
          // Full serial runs can leave Postgres checkpointing while the next
          // file resets shared tables. Keep suite hooks on the same budget as
          // the DB-backed tests so a slow reset cannot skip an entire file.
          hookTimeout: 30_000,
        },
      },
      {
        test: {
          // B6.14: every endpoint over the seeded golden DB via fastify.inject.
          name: 'api',
          include: ['apps/server/test/api/**/*.test.ts'],
          globalSetup: ['./apps/server/test/helpers/global-setup.ts'],
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 30_000,
        },
      },
      {
        test: {
          // B8.1: the live transport against a real SMTP+IMAP server
          // (GreenMail container — `docker compose up -d greenmail`). Serial:
          // the mail server is shared state, reset per test.
          name: 'mail',
          include: ['apps/server/test/mail/**/*.test.ts'],
          globalSetup: ['./apps/server/test/helpers/global-setup.ts'],
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 30_000,
        },
      },
      {
        test: {
          // The locked regression (docs/13 §3). NEVER skip — red here means
          // the math stopped closing. Separate required CI job.
          name: 'golden',
          include: ['apps/server/test/golden/**/*.test.ts'],
          globalSetup: ['./apps/server/test/helpers/global-setup.ts'],
          fileParallelism: false,
          testTimeout: 120_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
