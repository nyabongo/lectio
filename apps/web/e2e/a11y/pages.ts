/**
 * Every page type of the fixture build, for the accessibility suite (L-064). Paths are relative to the preview's
 * base URL (`/lectio/`). Keep this list in step with `pageTypes` in ../screenshots.spec.ts when a page type is added.
 */
import type { Page } from '@playwright/test';

import { BUILD_DATE, EXPECTS_404, expect } from '../fixtures.ts';

export interface PageType {
  /** A short name for the test title. */
  readonly name: string;
  /** Path under the base URL. */
  readonly path: string;
  /** A Playwright tag, e.g. `EXPECTS_404` for the not-found page. */
  readonly tag?: string;
  /** A tab to open (by click) before checking, on the reading page. */
  readonly tab?: string;
  /** A selector to wait for before checking, for pages that finish rendering in the browser. */
  readonly ready?: string;
}

export const pageTypes: readonly PageType[] = [
  { name: 'today', path: '' },
  { name: 'day', path: `${BUILD_DATE}/` },
  // A red feast, so a second liturgical accent is checked on real pages.
  { name: 'day-red', path: '2026-09-21/' },
  // Holy Saturday: a day without any Mass (L-048b), with its explanation instead of readings.
  { name: 'day-no-mass', path: '2026-04-04/' },
  { name: 'reading-context', path: `${BUILD_DATE}/gospel/` },
  { name: 'reading-original', path: `${BUILD_DATE}/gospel/`, tab: 'Original' },
  { name: 'insight', path: `${BUILD_DATE}/gospel/notes/v15-evil-eye/` },
  { name: 'calendar', path: 'calendar/' },
  { name: 'calendar-month', path: 'calendar/2026/09/' },
  { name: 'passages', path: 'passages/' },
  { name: 'passage', path: 'passages/MT.20.1-16/' },
  { name: 'search', path: 'search/', ready: '.pagefind-ui__search-input' },
  { name: 'settings', path: 'settings/', ready: '[data-settings-form][data-ready]' },
  { name: 'about', path: 'about/' },
  { name: 'not-found', path: 'no-such-page/', tag: EXPECTS_404 },
  // Kiswahili mirrors (L-110): the same page types under /sw/.
  { name: 'sw-today', path: 'sw/' },
  { name: 'sw-day', path: `sw/${BUILD_DATE}/` },
  { name: 'sw-day-no-mass', path: 'sw/2026-04-04/' },
  // The Gospel has a reviewed Kiswahili translation in the fixture (L-113): Kiswahili notes on both tabs.
  { name: 'sw-reading-context', path: `sw/${BUILD_DATE}/gospel/` },
  { name: 'sw-reading-original', path: `sw/${BUILD_DATE}/gospel/`, tab: 'Asilia' },
  { name: 'sw-insight', path: `sw/${BUILD_DATE}/gospel/notes/v15-evil-eye/` },
  { name: 'sw-calendar', path: 'sw/calendar/' },
  { name: 'sw-calendar-month', path: 'sw/calendar/2026/09/' },
  { name: 'sw-passages', path: 'sw/passages/' },
  { name: 'sw-passage', path: 'sw/passages/MT.20.1-16/' },
  { name: 'sw-search', path: 'sw/search/', ready: '.pagefind-ui__search-input' },
  { name: 'sw-settings', path: 'sw/settings/', ready: '[data-settings-form][data-ready]' },
  { name: 'sw-about', path: 'sw/about/' },
];

/** Opens a page type and waits until it has finished rendering: heading, tab, browser-rendered UI and web fonts. */
export async function openPage(page: Page, { path, tab, ready }: Pick<PageType, 'path' | 'tab' | 'ready'>) {
  await page.goto(path);
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  if (tab !== undefined) {
    await page.getByRole('tab', { name: tab }).click();
    await expect(page.getByRole('tab', { name: tab })).toHaveAttribute('aria-selected', 'true');
  }
  if (ready !== undefined) await expect(page.locator(ready).first()).toBeAttached();
  await page.evaluate(() => document.fonts.ready);
}
