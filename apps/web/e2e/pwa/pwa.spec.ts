/**
 * PWA checks (L-061) over the fixture build: the web app manifest, the service worker's lifecycle, installability
 * and reading a pre-cached upcoming day offline. The fixture calendar has 2026-09-19 to 2026-09-21 (and Holy
 * Saturday, 2026-04-04) and every page
 * runs on 2026-09-20 (fixtures.ts), so the worker keeps the 20th and the 21st as "the next seven days".
 */
import type { Page } from '@playwright/test';

import { BUILD_DATE, expect, test } from '../fixtures.ts';

/** The day after the build date: never opened in the offline test before the network goes away. */
const NEXT_DAY = '2026-09-21';
const NEXT_DAY_TITLE = 'Saint Matthew, Apostle and Evangelist';

interface ManifestIcon {
  src: string;
  sizes: string;
  type?: string;
  purpose?: string;
}

interface Manifest {
  name?: string;
  short_name?: string;
  start_url?: string;
  scope?: string;
  display?: string;
  theme_color?: string;
  icons?: ManifestIcon[];
}

/**
 * Waits for the worker to be ready, reloads, and waits until it controls the page. Returns the worker's state and
 * whether the reload was answered by its fetch handler.
 */
async function waitForController(page: Page): Promise<{ state: string; fromServiceWorker: boolean }> {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  const response = await page.reload();
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  const state = await page.evaluate(async () => (await navigator.serviceWorker.ready).active?.state ?? 'none');
  return { state, fromServiceWorker: response?.fromServiceWorker() ?? false };
}

/** Whether `url` is in any Lectio cache, as seen from the page. */
function isCached(page: Page, url: string): Promise<boolean> {
  return page.evaluate(async (target) => (await caches.match(target)) !== undefined, url);
}

test.describe('Web app manifest', () => {
  test('is linked, parses and is installable', async ({ page, baseURL }) => {
    await page.goto('');
    const href = await page.locator('link[rel="manifest"]').getAttribute('href');
    expect(href).toBe('/lectio/manifest.webmanifest');
    const manifestUrl = new URL(href ?? '', baseURL).href;
    const response = await page.request.get(manifestUrl);
    expect(response.ok()).toBe(true);
    const manifest = (await response.json()) as Manifest;

    expect(manifest.name).toBe('Lectio');
    expect(manifest.short_name).toBe('Lectio');
    expect(manifest.display).toBe('standalone');
    const startUrl = new URL(manifest.start_url ?? '', manifestUrl).href;
    const scope = new URL(manifest.scope ?? '.', manifestUrl).href;
    expect(startUrl).toBe(new URL('/lectio/', baseURL).href);
    expect(startUrl.startsWith(scope)).toBe(true);

    const icons = manifest.icons ?? [];
    const purposes = (icon: ManifestIcon): string[] => (icon.purpose ?? 'any').split(/\s+/);
    for (const size of ['192x192', '512x512'])
      expect(icons.some((icon) => icon.sizes === size && purposes(icon).includes('any'))).toBe(true);
    expect(icons.some((icon) => purposes(icon).includes('maskable'))).toBe(true);
    for (const icon of icons) {
      const image = await page.request.get(new URL(icon.src, manifestUrl).href);
      expect(image.ok(), icon.src).toBe(true);
      expect(image.headers()['content-type']).toContain(icon.type ?? 'image/');
    }
    // Installability: a secure context (localhost) and a theme colour that matches the page's.
    expect(await page.evaluate(() => window.isSecureContext)).toBe(true);
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', manifest.theme_color ?? '');
  });
});

test.describe('Service worker', () => {
  test('activates, controls the page after a reload and has a fetch handler', async ({ page }) => {
    await page.goto('');
    expect(await waitForController(page)).toEqual({ state: 'activated', fromServiceWorker: true });
    const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
    expect(new URL(scope).pathname).toBe('/lectio/');
    // The shell is precached, the offline page with it.
    const shell = await page.evaluate(async () => (await caches.keys()).filter((name) => name.startsWith('lectio-')));
    expect(shell.some((name) => name.startsWith('lectio-shell-'))).toBe(true);
    // Hashed bundles live in the shared asset cache, so pages cached by an older build keep their CSS and JS.
    expect(shell).toContain('lectio-assets');
    expect(await isCached(page, new URL('offline/', scope).href)).toBe(true);
    expect(await isCached(page, new URL('manifest.webmanifest', scope).href)).toBe(true);
  });

  test('keeps the next seven days and the days already opened', async ({ page, baseURL }) => {
    await page.goto(`${BUILD_DATE}/`);
    await waitForController(page);
    const url = (path: string): string => new URL(path, baseURL).href;
    // The fixture build has Listen on, so each upcoming day's Listen page is kept too.
    for (const path of [
      `${BUILD_DATE}/`,
      `${NEXT_DAY}/`,
      `${NEXT_DAY}/gospel/`,
      `${NEXT_DAY}/listen/`,
      `api/v1/days/${NEXT_DAY}.json`,
    ])
      await expect.poll(() => isCached(page, url(path)), { message: path }).toBe(true);
    // The 19th is in the calendar but before today: not upcoming, and not opened yet.
    expect(await isCached(page, url('2026-09-19/'))).toBe(false);
    const names = await page.evaluate(() => caches.keys());
    expect(names).toEqual(expect.arrayContaining(['lectio-data-upcoming']));

    // Opening it puts it in the visited cache.
    await page.goto('2026-09-19/');
    await expect.poll(() => isCached(page, url('2026-09-19/'))).toBe(true);
  });

  test("keeps the next seven days in the reader's saved language, with its shell", async ({
    page,
    context,
    baseURL,
  }) => {
    // A reader who chose Kiswahili in Settings (L-110).
    await page.addInitScript(() => {
      localStorage.setItem('lectio.settings', JSON.stringify({ version: 1, language: 'sw' }));
    });
    await page.goto(`sw/${BUILD_DATE}/`);
    await waitForController(page);
    const url = (path: string): string => new URL(path, baseURL).href;
    for (const path of [
      'sw/',
      'sw/settings/',
      `sw/${NEXT_DAY}/`,
      `sw/${NEXT_DAY}/gospel/`,
      `sw/${NEXT_DAY}/listen/`,
      `api/v1/sw/days/${NEXT_DAY}.json`,
    ])
      await expect.poll(() => isCached(page, url(path)), { message: path }).toBe(true);
    // The English pages of the days ahead are not fetched for a Kiswahili reader.
    expect(await isCached(page, url(`${NEXT_DAY}/gospel/`))).toBe(false);

    await context.setOffline(true);
    await page.goto(`sw/${NEXT_DAY}/listen/`);
    await expect(page.getByRole('heading', { level: 1, name: 'Sikiliza' })).toBeVisible();
    await page.goto('sw/settings/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    // A Kiswahili page that was never saved falls back to the Kiswahili offline page.
    await page.goto('sw/calendar/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Ukurasa huu haujahifadhiwa kwa kusoma bila mtandao',
    );
    await context.setOffline(false);
  });

  test('loads a pre-cached upcoming day with the network disabled', async ({ page, context, baseURL }) => {
    await page.goto('');
    await waitForController(page);
    const nextDay = new URL(`${NEXT_DAY}/`, baseURL).href;
    await expect.poll(() => isCached(page, nextDay)).toBe(true);
    await expect.poll(() => isCached(page, new URL(`${NEXT_DAY}/gospel/`, baseURL).href)).toBe(true);

    await context.setOffline(true);
    await page.goto(`${NEXT_DAY}/`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(NEXT_DAY_TITLE);
    // The shell's stylesheet came from the cache too: the page is styled.
    expect(await page.evaluate(() => document.styleSheets.length)).toBeGreaterThan(0);
    await page
      .getByRole('link', { name: /Gospel|John|Matthew/ })
      .first()
      .click();
    await expect(page).toHaveURL(new RegExp(`/lectio/${NEXT_DAY}/`));
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    // A page that was never saved falls back to the offline page.
    await page.goto('calendar/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('This page is not saved for offline reading');
    await context.setOffline(false);
  });
});
