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
  { name: 'reading-context', path: `${BUILD_DATE}/gospel/` },
  { name: 'reading-original', path: `${BUILD_DATE}/gospel/`, tab: 'Original' },
  { name: 'calendar', path: 'calendar/' },
  { name: 'calendar-month', path: 'calendar/2026/09/' },
  { name: 'passages', path: 'passages/' },
  { name: 'passage', path: 'passages/MT.20.1-16/' },
  { name: 'settings', path: 'settings/' },
  { name: 'about', path: 'about/' },
  { name: 'not-found', path: 'no-such-page/', tag: EXPECTS_404 },
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
