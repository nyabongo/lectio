/**
 * axe-core gate (L-064): every page type, in the light and the dark scheme, on both projects (desktop and mobile).
 * A serious or critical violation of WCAG 2.0/2.1/2.2 A and AA fails the test; minor and moderate findings are
 * attached to the report for review but do not fail it.
 */
import AxeBuilder from '@axe-core/playwright';

import { expect, test } from '../fixtures.ts';
import { openPage, pageTypes } from './pages.ts';

/** The WCAG rule sets the gate runs (axe tags). */
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
/** Impacts that fail the gate. */
const BLOCKING = new Set(['serious', 'critical']);

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

        const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
        const summary = results.violations.map((violation) => ({
          id: violation.id,
          impact: violation.impact,
          help: violation.help,
          targets: violation.nodes.map((node) => node.target.join(' ')),
        }));
        if (summary.length > 0) {
          await testInfo.attach(`axe-${scheme}-${name}`, {
            body: JSON.stringify(summary, null, 2),
            contentType: 'application/json',
          });
        }
        expect(summary.filter((violation) => BLOCKING.has(violation.impact ?? ''))).toEqual([]);
      });
    }
  });
}
