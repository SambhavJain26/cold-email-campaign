import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

// Real-backend walkthrough replay (docs/13 §5, closes M3). Two servers:
//   - the Fastify app in SIMULATED_CLOCK mode on :3001 (VirtualClock + inline
//     jobs + POST /system/advance-clock + the transport-scripting hooks), its
//     command migrates → resets → boots against the test DB;
//   - the web app in real mode on :5174 (MSW off, /api proxied to :3001).
// Run: npm run e2e:real -w @coldemail/web  (needs docker Postgres on :5433).
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const OPERATOR_EMAIL = 'operator@e2e.dev';
const OPERATOR_INITIAL_PASSWORD = 'e2e-operator-pass-123';
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgres://coldemail:coldemail_dev@localhost:5433/coldemail_test';

const serverEnv: Record<string, string> = {
  DATABASE_URL: TEST_DATABASE_URL,
  SECRET_KEY: 'ab'.repeat(32),
  SESSION_KEY: 'cd'.repeat(32),
  OPERATOR_EMAIL,
  OPERATOR_INITIAL_PASSWORD,
  MAIL_TRANSPORT: 'mock',
  SIMULATED_CLOCK: 'true',
  NODE_ENV: 'development',
  ROLE: 'all',
  HOST: '127.0.0.1',
  PORT: '3001',
  LOG_LEVEL: 'warn',
};

export default defineConfig({
  testDir: './e2e-real',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:5174',
    trace: 'on-first-retry',
    // e2e operator creds, so the spec can log in without hardcoding them twice.
    storageState: undefined,
  },
  metadata: { operatorEmail: OPERATOR_EMAIL, operatorPassword: OPERATOR_INITIAL_PASSWORD },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command:
        'npm run db:migrate -w @coldemail/server && npx tsx apps/server/test/ops/e2e-reset.ts && npm run start -w @coldemail/server',
      cwd: repoRoot,
      env: serverEnv,
      url: 'http://localhost:3001/health',
      reuseExistingServer: false,
      timeout: 90_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: 'npm run dev -- --port 5174 --strictPort',
      env: { VITE_API_MODE: 'real', VITE_API_TARGET: 'http://localhost:3001' },
      url: 'http://localhost:5174',
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
