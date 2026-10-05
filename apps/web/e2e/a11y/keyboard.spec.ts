/**
 * Keyboard, language, motion and reflow checks that axe cannot make on its own (L-064, WCAG 2.2 AA):
 *
 * - the skip link is the first stop, shows when focused and moves past the header;
 * - every keyboard stop draws a visible focus indicator (on the element or its `::after` overlay);
 * - original-language text carries `lang` and `dir` (Hebrew right-to-left);
 * - with `prefers-reduced-motion: reduce` nothing transitions or animates;
 * - at 320 CSS px wide (a 640 px window at 200% zoom), also with the largest text setting, and with text alone at
 *   200% on desktop and on the phone, no page scrolls sideways;
 * - the day's liturgical colour is visible as text, not only as a swatch (1.4.1, #202).
 *
 * Tabs moving by arrow keys, Home and End are covered in ../smoke.spec.ts.
 */
import { BUILD_DATE, expect, test } from '../fixtures.ts';
import { HEBREW_DATE, openPage, pageTypes } from './pages.ts';

/** How many Tab presses the focus check walks per page (enough to cover header, main content and footer). */
const MAX_TAB_STOPS = 60;

test.describe('skip link', () => {
  test('is the first Tab stop, visible when focused, and jumps to the main content', async ({ page }) => {
    await openPage(page, { path: `${BUILD_DATE}/` });
    await page.keyboard.press('Tab');
    const skip = page.locator('a.skip-link');
    await expect(skip).toBeFocused();
    await expect(skip).toHaveAttribute('href', '#main');
    await expect(skip).toBeInViewport();

    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#main$/);
    await page.keyboard.press('Tab');
    const inMain = await page.evaluate(() => document.activeElement?.closest('main') !== null);
    expect(inMain).toBe(true);
  });
});

test.describe('visible focus', () => {
  for (const pageType of pageTypes) {
    const { name, tag } = pageType;
    test(`${name}: every Tab stop shows a focus indicator`, { tag: tag ?? [] }, async ({ page }) => {
      await openPage(page, pageType);
      // Start from the top of the document, as a keyboard user arriving on the page would.
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      const missing: string[] = [];
      const seen = new Set<string>();
      for (let stop = 0; stop < MAX_TAB_STOPS; stop++) {
        await page.keyboard.press('Tab');
        const result = await page.evaluate(() => {
          const element = document.activeElement;
          if (element === null || element === document.body) return null;
          const shows = (style: CSSStyleDeclaration) =>
            style.outlineStyle !== 'none' && Number.parseFloat(style.outlineWidth) >= 2;
          const visible = shows(getComputedStyle(element)) || shows(getComputedStyle(element, '::after'));
          const label = `${element.tagName.toLowerCase()}${element.id === '' ? '' : `#${element.id}`} "${(
            element.textContent ?? ''
          )
            .trim()
            .slice(0, 40)}"`;
          const path: string[] = [];
          for (let node: Element | null = element; node !== null; node = node.parentElement) {
            path.unshift(`${node.tagName}:${Array.prototype.indexOf.call(node.parentElement?.children ?? [], node)}`);
          }
          return { key: path.join('/'), label, visible };
        });
        if (result === null) break;
        // Back at a stop we have seen: the walk has wrapped around the page.
        if (seen.has(result.key)) break;
        seen.add(result.key);
        if (!result.visible) missing.push(result.label);
      }
      expect(seen.size).toBeGreaterThan(0);
      expect(missing).toEqual([]);
    });
  }
});

test.describe('original-language text', () => {
  const pages = [
    { name: 'reading-original', path: `${BUILD_DATE}/gospel/`, tab: 'Original' },
    { name: 'insight', path: `${BUILD_DATE}/gospel/notes/v15-evil-eye/` },
    { name: 'passage', path: 'passages/MT.20.1-16/' },
    // Hebrew, so the right-to-left branch runs.
    { name: 'reading-hebrew', path: `${HEBREW_DATE}/first-reading/`, tab: 'Original', rtl: true },
    { name: 'insight-hebrew', path: `${HEBREW_DATE}/first-reading/notes/v9-bronze-serpent/`, rtl: true },
    { name: 'passage-hebrew', path: 'passages/NM.21.4-9/', rtl: true },
  ];
  for (const pageType of pages) {
    const { name } = pageType;
    test(`${name}: Greek, Hebrew and Latin text carries lang and dir`, async ({ page }) => {
      await openPage(page, pageType);
      const original = await page.evaluate(() =>
        [...document.querySelectorAll('main [lang]')]
          .map((element) => ({ lang: element.getAttribute('lang') ?? '', dir: element.getAttribute('dir') }))
          .filter(({ lang }) => /^(grc|el|he|hbo|arc|la)\b/.test(lang)),
      );
      expect(original.length).toBeGreaterThan(0);
      for (const { lang, dir } of original) {
        expect(dir, `dir for lang="${lang}"`).toBe(/^(he|hbo|arc)\b/.test(lang) ? 'rtl' : 'ltr');
      }
      if ('rtl' in pageType) expect(original.some(({ dir }) => dir === 'rtl')).toBe(true);
    });
  }
});

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  for (const pageType of pageTypes) {
    const { name, tag } = pageType;
    test(`${name}: nothing transitions or animates`, { tag: tag ?? [] }, async ({ page }) => {
      await openPage(page, pageType);
      const moving = await page.evaluate(() => {
        const seconds = (value: string) =>
          Math.max(
            ...value.split(',').map((part) => {
              const amount = Number.parseFloat(part);
              return part.trim().endsWith('ms') ? amount / 1000 : amount;
            }),
          );
        const found: string[] = [];
        for (const element of document.querySelectorAll('*')) {
          for (const pseudo of [null, '::before', '::after']) {
            const style = getComputedStyle(element, pseudo);
            const transition = seconds(style.transitionDuration);
            const animation = style.animationName === 'none' ? 0 : seconds(style.animationDuration);
            if (transition > 0.001 || animation > 0.001) {
              found.push(`${element.tagName.toLowerCase()}.${element.classList[0] ?? ''}${pseudo ?? ''}`);
            }
          }
        }
        return {
          found,
          scrollBehavior: getComputedStyle(document.documentElement).scrollBehavior,
        };
      });
      expect(moving.found).toEqual([]);
      expect(moving.scrollBehavior).not.toBe('smooth');
    });
  }
});

/** Reflow (1.4.10) and text resize (1.4.4) cases: a viewport width (or the project's own) and a root font size. */
const reflowCases = [
  // A 640 px window at 200% zoom lays the page out at 320 CSS px.
  { label: '320 px (200% zoom)', width: 320, fontSize: '100%' },
  // The same with the largest text size the settings page offers.
  { label: '320 px with the largest text setting', width: 320, fontSize: '125%' },
  // Text alone at 200% on each project's own viewport: 1280 px on desktop, 412 px on the phone (Pixel 7). On the phone
  // that lays text out as if the page were 206 px wide, narrower than the 320 px floor of 1.4.10, and it still must
  // not scroll sideways.
  { label: '200% text', width: undefined, fontSize: '200%' },
] as const;

test.describe('reflow and text resize', () => {
  for (const { label, width, fontSize } of reflowCases) {
    for (const pageType of pageTypes) {
      const { name, tag } = pageType;
      test(`${name}: no sideways scroll at ${label}`, { tag: tag ?? [] }, async ({ page }) => {
        if (width !== undefined) await page.setViewportSize({ width, height: 640 });
        await openPage(page, pageType);
        await page.evaluate((size) => {
          document.documentElement.style.fontSize = size;
        }, fontSize);
        const overflow = await page.evaluate(() => {
          const viewport = document.documentElement.clientWidth;
          const clips = (node: Element) =>
            ['auto', 'scroll', 'hidden', 'clip'].includes(getComputedStyle(node).overflowX);
          // Elements past the right edge, ignoring hidden helpers and those inside their own scroll container.
          const wide = [...document.querySelectorAll('body *')]
            .filter((element) => {
              const box = element.getBoundingClientRect();
              if (box.width === 0 || box.right <= viewport + 1) return false;
              if (element.closest('.visually-hidden, .skip-link') !== null) return false;
              for (
                let node = element.parentElement;
                node !== null && node !== document.body;
                node = node.parentElement
              ) {
                if (clips(node)) return false;
              }
              return true;
            })
            .map((element) => `${element.tagName.toLowerCase()}.${element.classList[0] ?? ''}`);
          return { scrollWidth: document.documentElement.scrollWidth, viewport, wide: wide.slice(0, 10) };
        });
        expect(overflow.wide).toEqual([]);
        expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.viewport);
      });
    }
  }
});

test.describe('use of colour', () => {
  const days = [
    { path: `${BUILD_DATE}/`, rank: 'Sunday', colour: 'Green' },
    { path: '2026-09-21/', rank: 'Feast', colour: 'Red' },
  ];
  for (const { path, rank, colour } of days) {
    test(`/${path} names the liturgical colour (${colour}) in visible text next to the rank`, async ({ page }) => {
      await openPage(page, { path });
      const meta = page.locator('.day__rank');
      await expect(meta).toHaveText(new RegExp(`${rank}\\s*· ${colour}`));
      await expect(meta.getByText(`· ${colour}`, { exact: true })).toBeVisible();
      await expect(meta.locator('.swatch')).toHaveAttribute('aria-hidden', 'true');
    });
  }
});
