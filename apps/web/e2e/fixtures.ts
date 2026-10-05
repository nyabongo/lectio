/**
 * Shared Playwright fixtures for the e2e smoke suite.
 *
 * - Every page runs on a fixed clock: 2026-09-20 08:00 in Nairobi (the fixture build date). `setFixedTime` pins
 *   `Date` while timers keep running, so the pages' own timeouts still fire.
 * - Console errors and uncaught page errors fail the test that caused them.
 * - Requests that would leave the preview server are refused, so the suite stays offline and a page that depends on
 *   a remote resource shows up as an error here.
 */
import { test as base, expect } from '@playwright/test';

/** 2026-09-20 08:00 in Africa/Nairobi (UTC+3). */
export const NOW = new Date('2026-09-20T08:00:00+03:00');

/** The fixture build date and the Sunday whose Gospel carries the evil-eye note. */
export const BUILD_DATE = '2026-09-20';

/** Tag for a test that loads a missing page on purpose: its "404 (Not Found)" console error is expected. */
export const EXPECTS_404 = '@expects-404';

/**
 * `page` with a fixed clock, offline routing and an error check: once the test body has passed, any console error
 * or uncaught page error fails it.
 */
export const test = base.extend({
  page: async ({ page, baseURL }, use, testInfo) => {
    const errors: string[] = [];
    const origin = new URL(baseURL ?? 'http://localhost/').origin;
    await page.route(
      (url) => url.origin !== origin,
      (route) => route.abort('blockedbyclient'),
    );
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(`console: ${message.text()}`);
    });
    page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
    await page.clock.setFixedTime(NOW);
    await use(page);
    if (testInfo.status !== testInfo.expectedStatus) return;
    const allowed = testInfo.tags.includes(EXPECTS_404) ? [/404 \(Not Found\)/] : [];
    expect(errors.filter((error) => !allowed.some((pattern) => pattern.test(error)))).toEqual([]);
  },
});

export { expect };
