/**
 * axe-core gate (L-064): every page type, in the light and the dark scheme, on both projects (desktop and mobile).
 * A serious or critical violation of WCAG 2.0/2.1/2.2 A and AA fails the test; minor and moderate findings are
 * attached to the report for review but do not fail it. The rule set and threshold are shared (./axe.ts).
 */
import { expect, test } from '../fixtures.ts';
import { blockingAxeFindings } from './axe.ts';
import { openPage, pageTypes } from './pages.ts';

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`axe (${scheme})`, () => {
    test.use({ colorScheme: scheme });

    for (const pageType of pageTypes) {
      const { name, tag } = pageType;
      test(`${name} has no serious or critical violations`, { tag: tag ?? [] }, async ({ page }, testInfo) => {
        await openPage(page, pageType);
        // The scheme really applies, so axe measures both palettes.
        const applied = await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme);
        expect(applied).toBe(scheme);

        expect(await blockingAxeFindings(page, { attach: { testInfo, name: `axe-${scheme}-${name}` } })).toEqual([]);
      });
    }
  });
}
