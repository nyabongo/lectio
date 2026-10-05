/**
 * Kiswahili UI (L-110): the `/sw/` mirrors render in Kiswahili with `<html lang="sw">`, sw-KE dates and hreflang
 * alternates; the language switcher and the settings page save the choice, and the English Today page then sends
 * the reader to the Kiswahili one.
 */
import { BUILD_DATE, expect, test } from './fixtures.ts';

const SITE = 'https://nyabongo.github.io/lectio/';

test.describe('Kiswahili pages', () => {
  const pages = ['sw/', `sw/${BUILD_DATE}/`, `sw/${BUILD_DATE}/gospel/`, 'sw/calendar/', 'sw/calendar/2026/09/'];

  for (const path of pages) {
    test(`/${path} is in Kiswahili with hreflang alternates`, async ({ page }) => {
      await page.goto(path);
      await expect(page.locator('html')).toHaveAttribute('lang', 'sw');
      await expect(page.getByRole('navigation', { name: 'Tovuti' })).toBeVisible();
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `${SITE}${path}`);
      const english = path.slice('sw/'.length);
      await expect(page.locator('link[rel="alternate"][hreflang="en"]')).toHaveAttribute('href', `${SITE}${english}`);
      await expect(page.locator('link[rel="alternate"][hreflang="sw"]')).toHaveAttribute('href', `${SITE}${path}`);
      await expect(page.locator('link[rel="alternate"][hreflang="x-default"]')).toHaveAttribute(
        'href',
        `${SITE}${english}`,
      );
    });
  }

  test('the day page writes its date the Kenyan Kiswahili way', async ({ page }) => {
    await page.goto(`sw/${BUILD_DATE}/`);
    await expect(page.locator(`time[datetime="${BUILD_DATE}"]`).first()).toHaveText('Jumapili 20 Septemba 2026');
    await expect(page.getByRole('heading', { name: 'Masomo' })).toBeVisible();
    await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /^Jumapili 20 Septemba 2026: /);
  });
});

test.describe('Language switcher', () => {
  test('switches the page and remembers the choice on the Today page', async ({ page }) => {
    await page.goto('calendar/');
    await page.getByRole('link', { name: 'Kiswahili' }).click();
    await expect(page).toHaveURL(/\/lectio\/sw\/calendar\/$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Kalenda');

    // The English Today page now opens in Kiswahili.
    await page.goto('');
    await expect(page).toHaveURL(/\/lectio\/sw\/$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'sw');

    // Switching back to English sticks too.
    await page.getByRole('link', { name: 'English' }).click();
    await expect(page).toHaveURL(/\/lectio\/$/);
    await page.goto('');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  });

  test('the settings page changes the language', async ({ page }) => {
    await page.goto('settings/');
    await expect(page.locator('[data-settings-form]')).toHaveAttribute('data-ready', '');
    await page.getByRole('radio', { name: 'Kiswahili' }).check();
    await expect(page).toHaveURL(/\/lectio\/sw\/settings\/$/);
    await expect(page.getByRole('radio', { name: 'Kiswahili' })).toBeChecked();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Mipangilio');
  });
});
