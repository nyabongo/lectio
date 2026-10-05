/**
 * Smoke tests over the fixture build (apps/web/test/fixtures/content), on desktop Chromium and a Pixel 7. Each test
 * also fails on any console error (see fixtures.ts). Text here is the site's own English copy, never reading text.
 */
import { BUILD_DATE, EXPECTS_404, expect, test } from './fixtures.ts';

const SUNDAY_TITLE = 'Twenty-fifth Sunday in Ordinary Time';
const GOSPEL_LINKOUT = 'https://www.drbo.org/chapter/47020.htm';

test.describe('Today', () => {
  test('`/` shows the day for the fixed clock', async ({ page }) => {
    await page.goto('');
    await expect(page).toHaveURL(/\/lectio\/$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(SUNDAY_TITLE);
    await expect(page.getByRole('link', { name: 'Matthew 20:1–16a', exact: true })).toHaveAttribute(
      'href',
      `/lectio/${BUILD_DATE}/gospel/`,
    );
  });

  test('`/` moves to the day page for the device date when it differs from the build date', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-09-21T08:00:00+03:00'));
    await page.goto('');
    await expect(page).toHaveURL(/\/lectio\/2026-09-21\/$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Saint Matthew, Apostle and Evangelist');
  });
});

test.describe('Day page', () => {
  test('lists the readings with link-outs and moves between days', async ({ page }) => {
    await page.goto(`${BUILD_DATE}/`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(SUNDAY_TITLE);
    for (const slot of ['First reading', 'Psalm', 'Second reading', 'Gospel']) {
      await expect(page.getByText(slot, { exact: true })).toBeVisible();
    }
    const textLinks = page.locator('a.reading__text');
    await expect(textLinks).toHaveCount(4);
    await expect(textLinks.last()).toHaveAttribute('href', GOSPEL_LINKOUT);
    await expect(textLinks.last()).toHaveAttribute('target', '_blank');
    await expect(textLinks.last()).toHaveAttribute('rel', /noopener/);

    await page.locator('a[rel="next"]').click();
    await expect(page).toHaveURL(/\/lectio\/2026-09-21\/$/);
    await page.locator('a[rel="prev"]').click();
    await expect(page).toHaveURL(new RegExp(`/lectio/${BUILD_DATE}/$`));

    await page.getByRole('link', { name: 'Matthew 20:1–16a', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/lectio/${BUILD_DATE}/gospel/$`));
  });
});

test.describe('Reading page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${BUILD_DATE}/gospel/`);
  });

  test('the 2026-09-20 Gospel shows the evil-eye note', async ({ page }) => {
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Mt 20:1-16a');
    await page.getByRole('tab', { name: 'Original' }).click();
    await expect(page.locator('#note-v15-evil-eye')).toBeVisible();
    await expect(page.locator('#note-v15-evil-eye .note__gloss')).toHaveText('“your eye evil”');
  });

  test('tabs switch by click', async ({ page }) => {
    const context = page.getByRole('tab', { name: 'Context' });
    const original = page.getByRole('tab', { name: 'Original' });
    await expect(context).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tabpanel', { name: 'Context' })).toBeVisible();

    await original.click();
    await expect(original).toHaveAttribute('aria-selected', 'true');
    await expect(context).toHaveAttribute('aria-selected', 'false');
    await expect(page.getByRole('tabpanel', { name: 'Original' })).toBeVisible();
    await expect(page.locator('[data-panel="context"]')).toBeHidden();
    await expect(page).toHaveURL(/#original$/);

    await context.click();
    await expect(page.getByRole('tabpanel', { name: 'Context' })).toBeVisible();
    await expect(page.locator('[data-panel="original"]')).toBeHidden();
  });

  test('tabs switch by keyboard (arrows, Home, End)', async ({ page }) => {
    const context = page.getByRole('tab', { name: 'Context' });
    const original = page.getByRole('tab', { name: 'Original' });
    await context.focus();

    await page.keyboard.press('ArrowRight');
    await expect(original).toBeFocused();
    await expect(original).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tabpanel', { name: 'Original' })).toBeVisible();

    await page.keyboard.press('ArrowRight');
    await expect(context).toBeFocused();
    await expect(context).toHaveAttribute('aria-selected', 'true');

    await page.keyboard.press('End');
    await expect(original).toBeFocused();
    await page.keyboard.press('Home');
    await expect(context).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(original).toBeFocused();
    await expect(page).toHaveURL(/#original$/);
  });

  test('a hash opens its tab on load', async ({ page }) => {
    await page.goto(`${BUILD_DATE}/gospel/#original`);
    await expect(page.getByRole('tab', { name: 'Original' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#note-v15-evil-eye')).toBeVisible();
  });

  test('the Text link-out opens the licensed source in a new tab', async ({ page }) => {
    const linkout = page.locator('a.tabs__linkout');
    await expect(linkout).toHaveAttribute('href', GOSPEL_LINKOUT);
    await expect(linkout).toHaveAttribute('target', '_blank');
    await expect(linkout).toHaveAttribute('rel', /noopener/);
    await expect(linkout).toHaveAccessibleName(/opens in a new tab/);
  });
});

test.describe('Calendar', () => {
  test('moves between months and into a day', async ({ page }) => {
    await page.goto('calendar/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Calendar');
    await page.getByRole('link', { name: /Go to September 2026/ }).click();
    await expect(page).toHaveURL(/\/calendar\/2026\/09\/$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('September 2026');

    const months = page.getByRole('navigation', { name: 'Other months' });
    await months.locator('a[rel="next"]').click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('October 2026');
    await months.locator('a[rel="prev"]').click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('September 2026');

    const today = page.locator('a.cell[aria-current="date"]');
    await expect(today).toHaveAttribute('href', `/lectio/${BUILD_DATE}/`);
    await today.click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(SUNDAY_TITLE);
  });
});

test.describe('Settings', () => {
  test('a theme and text size persist across reloads and pages', async ({ page }) => {
    await page.goto('settings/');
    const html = page.locator('html');
    await expect(page.locator('[data-settings-form]')).toHaveAttribute('data-ready', '');

    await page.getByRole('radio', { name: 'Dark' }).check();
    await expect(html).toHaveAttribute('data-theme', 'dark');
    await expect(page.getByRole('status')).not.toBeEmpty();
    await page.getByRole('radio', { name: 'Large', exact: true }).check();
    await expect(html).toHaveAttribute('data-text-size', 'large');

    await page.reload();
    await expect(html).toHaveAttribute('data-theme', 'dark');
    await expect(html).toHaveAttribute('data-text-size', 'large');
    await expect(page.getByRole('radio', { name: 'Dark' })).toBeChecked();
    await expect(page.getByRole('radio', { name: 'Large', exact: true })).toBeChecked();

    await page.goto(`${BUILD_DATE}/`);
    await expect(html).toHaveAttribute('data-theme', 'dark');
    await expect(html).toHaveAttribute('data-text-size', 'large');
  });
});

test.describe('404', () => {
  test('an unknown path shows the not-found page', { tag: EXPECTS_404 }, async ({ page }) => {
    const response = await page.goto('no-such-page/');
    expect(response?.status()).toBe(404);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('This page is not here');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
  });
});

test.describe('Meta tags', () => {
  const pages = [
    { path: '', title: 'Lectio' },
    { path: `${BUILD_DATE}/`, title: /Lectio/ },
    { path: `${BUILD_DATE}/gospel/`, title: 'Mt 20:1-16a · Gospel · Lectio' },
    { path: 'calendar/', title: /Lectio/ },
    { path: 'settings/', title: /Lectio/ },
  ];

  for (const { path, title } of pages) {
    test(`/${path} has its title, description, canonical and Open Graph tags`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveTitle(title);
      await expect(page.locator('html')).toHaveAttribute('lang', 'en');
      await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /\S/);
      await expect(page.locator('meta[name="viewport"]')).toHaveAttribute('content', /width=device-width/);
      const canonical = `https://nyabongo.github.io/lectio/${path}`;
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', canonical);
      await expect(page.locator('meta[property="og:url"]')).toHaveAttribute('content', canonical);
      await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', /\S/);
      await expect(page.locator('meta[property="og:description"]')).toHaveAttribute('content', /\S/);
      await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', /^https:\/\//);
      await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute('content', 'summary_large_image');
    });
  }
});
