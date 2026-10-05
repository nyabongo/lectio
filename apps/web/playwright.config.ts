/**
 * Playwright e2e smoke suite for the static site (L-063). It runs against `astro preview` of the fixture build
 * (LECTIO_CONFIG=apps/web/test/lectio.config.fixture.json, LECTIO_DATE=2026-09-20, and the fixture audio manifest), so
 * it never waits for approved real content. Two projects: desktop Chromium and mobile (Pixel 7). Every page runs on a fixed clock of
 * 2026-09-20 08:00 in Nairobi (see e2e/fixtures.ts).
 *
 * Run from the repository root:
 *   npx playwright install chromium   # once
 *   npx playwright test -c apps/web/playwright.config.ts
 *
 * The web server builds the fixture site and then previews it; set E2E_SKIP_BUILD=1 to preview an existing
 * apps/web/dist. E2E_PORT picks the port (default 4329). Full-page screenshots land in apps/web/e2e/__screenshots__
 * (git-ignored); CI uploads them as an artifact. Unit coverage is separate: this suite is not part of `npm test`.
 */
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig, devices } from '@playwright/test';

const webRoot = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.E2E_PORT ?? 4329);
const ci = process.env.CI !== undefined && process.env.CI !== '';
const build = process.env.E2E_SKIP_BUILD === '1' ? '' : 'npm run build:fixture && ';

/** Shared by both projects: the site's time zone and locale. */
const site = { timezoneId: 'Africa/Nairobi', locale: 'en-GB' } as const;

export default defineConfig({
  testDir: './e2e',
  // test-results/ and playwright-report/ are git-ignored.
  outputDir: './test-results',
  fullyParallel: true,
  forbidOnly: ci,
  retries: ci ? 1 : 0,
  workers: ci ? 2 : undefined,
  reporter: ci ? [['list'], ['github'], ['html', { open: 'never', outputFolder: 'playwright-report' }]] : 'list',
  use: {
    baseURL: `http://localhost:${port}/lectio/`,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], ...site } },
    { name: 'mobile', use: { ...devices['Pixel 7'], ...site } },
  ],
  webServer: {
    // `--ignore-lock` keeps `astro preview` in the foreground (inside an AI agent it otherwise starts a background
    // server and exits) and lets several checkouts preview at once.
    command: `${build}npm run preview -- --port ${port} --host localhost --ignore-lock`,
    cwd: webRoot,
    url: `http://localhost:${port}/lectio/`,
    // Never attach to a server some other checkout started on the same port.
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'pipe',
    env: {
      LECTIO_CONFIG: 'apps/web/test/lectio.config.fixture.json',
      LECTIO_DATE: '2026-09-20',
      // Narration (L-082): the API's audio fields and segments point at the tiny WAVs next to this manifest.
      LECTIO_AUDIO_MANIFEST: 'apps/web/test/fixtures/audio/manifest.json',
      ASTRO_TELEMETRY_DISABLED: '1',
    },
  },
});
