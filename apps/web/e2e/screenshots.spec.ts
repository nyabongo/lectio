/**
 * Full-page screenshots of every page type, per project (desktop, mobile), for review on the pull request. They are
 * not compared against a baseline (visual diffing is out of scope). Files land in
 * apps/web/e2e/__screenshots__/<project>/<page>.png (git-ignored); .github/workflows/e2e.yml uploads them and lists
 * them in the job summary.
 */
import { join } from 'node:path';

import { BUILD_DATE, EXPECTS_404, expect, test } from './fixtures.ts';

/** Where the screenshots go; e2e.yml reads the same directory. */
const SCREENSHOT_DIR = join(import.meta.dirname, '__screenshots__');

const pageTypes = [
  { name: 'today', path: '' },
  { name: 'day', path: `${BUILD_DATE}/` },
  // Holy Saturday: a day without any Mass (L-048b).
  { name: 'day-no-mass', path: '2026-04-04/' },
  { name: 'reading-context', path: `${BUILD_DATE}/gospel/` },
  { name: 'reading-original', path: `${BUILD_DATE}/gospel/`, tab: 'Original' },
  { name: 'insight', path: `${BUILD_DATE}/gospel/notes/v15-evil-eye/` },
  // The Listen player (L-085) and a day with nothing to listen to yet.
  { name: 'listen', path: `${BUILD_DATE}/listen/` },
  { name: 'listen-empty', path: '2026-09-21/listen/' },
  { name: 'calendar', path: 'calendar/' },
  { name: 'calendar-month', path: 'calendar/2026/09/' },
  { name: 'passages', path: 'passages/' },
  { name: 'passage', path: 'passages/MT.20.1-16/' },
  { name: 'settings', path: 'settings/' },
  { name: 'about', path: 'about/' },
  { name: 'offline', path: 'offline/' },
  { name: 'not-found', path: 'no-such-page/', tag: EXPECTS_404 },
  // Kiswahili mirrors (L-110).
  { name: 'sw-today', path: 'sw/' },
  { name: 'sw-day', path: `sw/${BUILD_DATE}/` },
  { name: 'sw-day-no-mass', path: 'sw/2026-04-04/' },
  // Kiswahili notes from the fixture's reviewed translation (L-113).
  { name: 'sw-reading-context', path: `sw/${BUILD_DATE}/gospel/` },
  { name: 'sw-reading-original', path: `sw/${BUILD_DATE}/gospel/`, tab: 'Asilia' },
  { name: 'sw-insight', path: `sw/${BUILD_DATE}/gospel/notes/v15-evil-eye/` },
  { name: 'sw-listen', path: `sw/${BUILD_DATE}/listen/` },
  { name: 'sw-calendar-month', path: 'sw/calendar/2026/09/' },
  { name: 'sw-passage', path: 'sw/passages/MT.20.1-16/' },
  { name: 'sw-settings', path: 'sw/settings/' },
  { name: 'sw-about', path: 'sw/about/' },
];

for (const { name, path, tag, tab } of pageTypes as { name: string; path: string; tag?: string; tab?: string }[]) {
  test(`screenshot: ${name}`, { tag: tag ?? [] }, async ({ page }, testInfo) => {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    if (tab !== undefined) {
      // Open the tab by click (not by hash), then capture from the top without focus rings or a scrolled sticky bar.
      await page.getByRole('tab', { name: tab }).click();
      await page.evaluate(() => {
        (document.activeElement as HTMLElement | null)?.blur();
        window.scrollTo(0, 0);
      });
    }
    // Web fonts are self-hosted; wait for them so the screenshot shows the real type.
    await page.evaluate(() => document.fonts.ready);
    const file = join(SCREENSHOT_DIR, testInfo.project.name, `${name}.png`);
    const image = await page.screenshot({ path: file, fullPage: true, animations: 'disabled' });
    await testInfo.attach(name, { body: image, contentType: 'image/png' });
  });
}
