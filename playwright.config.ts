import { defineConfig, devices } from '@playwright/test';
import * as dotenv from 'dotenv';

dotenv.config();

/**
 * Playwright Configuration
 * LaunchGuard QA - playwright-reliability-framework
 *
 * Designed for reliability-first automation:
 * - Retries on CI to absorb transient flakiness
 * - Parallel execution for speed
 * - HTML + GitHub Actions reporters
 * - Per-environment base URL via .env
 */
export default defineConfig({
  testDir: './tests',

  /* Run tests in files in parallel */
  fullyParallel: true,

  /* Fail the build on CI if you accidentally left test.only in source code */
  forbidOnly: !!process.env.CI,

  /* Retry on CI only — surfaces real flakiness without masking it locally */
  retries: process.env.CI ? 2 : 0,

  /* Opt out of parallel tests on CI to reduce resource contention */
  workers: process.env.CI ? 2 : undefined,

  /* Reporter configuration */
  reporter: [
    ['html', { outputFolder: 'reports/html', open: 'never' }],
    ['json', { outputFile: 'reports/results.json' }],
    process.env.CI ? ['github'] : ['list'],
  ],

  /* Global test settings */
  use: {
    baseURL: process.env.BASE_URL || 'https://www.saucedemo.com',

    /* Capture on failure only — keeps CI artifact sizes sane */
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'on-first-retry',

    /* Generous but not infinite timeouts */
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
  },

  /* Test timeout — 30s is reasonable for UI tests */
  timeout: 30_000,

  /* Expect timeout */
  expect: {
    timeout: 10_000,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
    /* Mobile viewports for cross-device coverage */
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 5'] },
    },
  ],

  /* Output folder for test artifacts */
  outputDir: 'reports/test-results',
});
