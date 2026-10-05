/**
 * The Share button (L-089) on the fixture build: a stubbed `navigator.share` receives the expected payload on the
 * day, reading and insight pages, and without Web Share the fallback popover copies the text and offers WhatsApp
 * and email links. Text here is the site's own copy and the fixture's summaries, never reading text.
 */
import { join } from 'node:path';

import type { Page } from '@playwright/test';

import { BUILD_DATE, expect, test } from '../fixtures.ts';

const SITE = 'https://nyabongo.github.io/lectio/';
const GOSPEL_SUMMARY =
  'A landowner pays the last hired the same as the first, and asks whether his goodness is a cause for resentment.';
const NOTE_TITLE = '“envious” · Mt 20:1-16a, verse 15';
const NOTE_SUMMARY = 'Greek asks “is your eye evil?”, an idiom for begrudging another’s good.';

const pages = [
  {
    name: 'day',
    path: `${BUILD_DATE}/`,
    payload: {
      title: 'Twenty-fifth Sunday in Ordinary Time, Sunday 20 September 2026',
      text: `Twenty-fifth Sunday in Ordinary Time, Sunday 20 September 2026\n${GOSPEL_SUMMARY}`,
      url: `${SITE}${BUILD_DATE}/`,
    },
  },
  {
    name: 'reading',
    path: `${BUILD_DATE}/gospel/`,
    payload: {
      title: 'Mt 20:1-16a · Gospel',
      text: `Mt 20:1-16a\n${GOSPEL_SUMMARY}`,
      url: `${SITE}${BUILD_DATE}/gospel/`,
    },
  },
  {
    name: 'insight',
    path: `${BUILD_DATE}/gospel/notes/v15-evil-eye/`,
    payload: {
      title: NOTE_TITLE,
      text: `${NOTE_TITLE}\n${NOTE_SUMMARY}`,
      url: `${SITE}${BUILD_DATE}/gospel/notes/v15-evil-eye/`,
    },
  },
];

declare global {
  interface Window {
    __shared?: unknown[];
  }
}

/** Replaces `navigator.share` before any page script runs: it records each payload, then resolves or rejects. */
async function stubShare(page: Page, outcome: 'resolve' | 'abort' | 'fail' | 'pending' = 'resolve'): Promise<void> {
  await page.addInitScript((mode) => {
    window.__shared = [];
    Object.defineProperty(Navigator.prototype, 'share', {
      configurable: true,
      value: (data: unknown) => {
        window.__shared?.push(data);
        if (mode === 'resolve') return Promise.resolve();
        // A sheet that stays open: the promise never settles.
        if (mode === 'pending') return new Promise<void>(() => undefined);
        return Promise.reject(new DOMException('stub', mode === 'abort' ? 'AbortError' : 'NotAllowedError'));
      },
    });
    Object.defineProperty(Navigator.prototype, 'canShare', { configurable: true, value: () => true });
  }, outcome);
}

/** Removes Web Share (most desktop browsers have none), and the Clipboard API too when `clipboard` is false. */
async function withoutShare(page: Page, clipboard = true): Promise<void> {
  await page.addInitScript((keepClipboard) => {
    delete (Navigator.prototype as Partial<Navigator>).share;
    delete (Navigator.prototype as Partial<Navigator>).canShare;
    if (!keepClipboard)
      Object.defineProperty(Navigator.prototype, 'clipboard', { configurable: true, value: undefined });
  }, clipboard);
}

const shareButton = (page: Page) => page.locator('summary.share__button');
const popover = (page: Page) => page.getByRole('group', { name: 'Ways to share' });

async function ready(page: Page): Promise<void> {
  await expect(page.locator('details[data-share]')).toHaveAttribute('data-ready', '');
}

test.describe('Share with Web Share', () => {
  for (const { name, path, payload } of pages) {
    test(`the ${name} page hands navigator.share its title, text and link`, async ({ page }) => {
      await stubShare(page);
      await page.goto(path);
      await ready(page);
      await shareButton(page).click();
      await expect.poll(() => page.evaluate(() => window.__shared)).toEqual([payload]);
      await expect(popover(page)).toBeHidden();
      expect(payload.url).not.toMatch(/[?&](utm_|fbclid|gclid)/);
    });
  }

  test('closing the share sheet leaves the popover closed', async ({ page }) => {
    await stubShare(page, 'abort');
    await page.goto(`${BUILD_DATE}/gospel/`);
    await ready(page);
    await shareButton(page).click();
    await expect.poll(() => page.evaluate(() => window.__shared?.length)).toBe(1);
    await expect(popover(page)).toBeHidden();
  });

  test('a second tap while the sheet is open does nothing', async ({ page }) => {
    await stubShare(page, 'pending');
    await page.goto(`${BUILD_DATE}/gospel/`);
    await ready(page);
    await shareButton(page).click();
    await shareButton(page).click();
    await expect.poll(() => page.evaluate(() => window.__shared?.length)).toBe(1);
    await expect(popover(page)).toBeHidden();
  });

  test('a failing share sheet opens the fallback popover', async ({ page }) => {
    await stubShare(page, 'fail');
    await page.goto(`${BUILD_DATE}/gospel/`);
    await ready(page);
    await shareButton(page).click();
    await expect(popover(page)).toBeVisible();
  });
});

test.describe('Share fallback', () => {
  const reading = pages[1];
  if (reading === undefined) throw new Error('reading page missing');
  const text = `${reading.payload.text}\n${reading.payload.url}`;

  test('copies the reference, insight and link to the clipboard', async ({ page, context, browserName }) => {
    test.skip(browserName !== 'chromium', 'clipboard permissions are Chromium-only');
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await withoutShare(page);
    await page.goto(reading.path);
    await ready(page);
    await shareButton(page).click();
    await expect(popover(page)).toBeVisible();
    await page.getByRole('button', { name: 'Copy link' }).click();
    await expect(popover(page).getByRole('status')).toHaveText('Copied the link with its reference.');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(text);
  });

  test('copies through the legacy path without the Clipboard API', async ({ page }) => {
    await withoutShare(page, false);
    await page.goto(reading.path);
    await ready(page);
    await page.evaluate(() => {
      document.addEventListener('copy', (event) => {
        const field = event.target instanceof HTMLTextAreaElement ? event.target : null;
        document.body.dataset.copied = field?.value.slice(field.selectionStart, field.selectionEnd) ?? '';
        event.preventDefault();
      });
    });
    await shareButton(page).click();
    await page.getByRole('button', { name: 'Copy link' }).click();
    await expect(popover(page).getByRole('status')).toHaveText('Copied the link with its reference.');
    await expect(page.locator('body')).toHaveAttribute('data-copied', text);
  });

  test('offers WhatsApp, email and the link, and closes on Escape', async ({ page }, testInfo) => {
    await withoutShare(page);
    await page.goto(reading.path);
    await ready(page);
    await shareButton(page).click();
    const group = popover(page);
    await expect(group).toBeVisible();

    const whatsapp = group.getByRole('link', { name: /WhatsApp/ });
    await expect(whatsapp).toHaveAttribute('href', `https://wa.me/?text=${encodeURIComponent(text)}`);
    await expect(whatsapp).toHaveAttribute('target', '_blank');
    await expect(whatsapp).toHaveAttribute('rel', /noopener/);
    await expect(group.getByRole('link', { name: 'Email' })).toHaveAttribute(
      'href',
      `mailto:?subject=${encodeURIComponent(reading.payload.title)}&body=${encodeURIComponent(text)}`,
    );
    await expect(group.getByRole('textbox', { name: 'Link to share' })).toHaveValue(reading.payload.url);

    await page.evaluate(() => document.fonts.ready);
    const image = await page.screenshot({
      path: join(import.meta.dirname, '..', '__screenshots__', testInfo.project.name, 'share-fallback.png'),
      animations: 'disabled',
    });
    await testInfo.attach('share-fallback', { body: image, contentType: 'image/png' });

    await page.keyboard.press('Escape');
    await expect(group).toBeHidden();
    await expect(shareButton(page)).toBeFocused();

    await shareButton(page).click();
    await expect(group).toBeVisible();
    await page.locator('h1').click();
    await expect(group).toBeHidden();
  });
});
