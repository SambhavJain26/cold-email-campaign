import { defineConfig, devices } from '@playwright/test';

// F0.7 — mock-mode e2e (docs/11 §4): the dev server boots with MSW serving the
// golden fixtures; specs run against it with NO backend. Real-mode runs
// (backend + MockTransport) land at the F8/M3 gate.
export default defineConfig({
  testDir: './src/e2e',
  timeout: 30_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
