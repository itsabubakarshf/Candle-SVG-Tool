import { defineConfig } from '@playwright/test';

const PORT = 3200;

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  expect: { timeout: 8_000 },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1440, height: 900 },
    // Locally the sandbox ships its own Chromium; CI uses the one Playwright installs.
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
    trace: 'retain-on-failure',
  },
  // Run `pnpm build` first. The tests use the production build.
  webServer: {
    command: `pnpm exec next start -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
