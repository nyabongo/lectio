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

test.describe('Language of parts', () => {
  test('English celebration names on Kiswahili pages carry lang="en"', async ({ page }) => {
    await page.goto(`sw/${BUILD_DATE}/gospel/`);
    await expect(page.locator('.site-header .celebration')).toHaveAttribute('lang', 'en');
    await page.goto(`sw/${BUILD_DATE}/`);
    await expect(page.locator('.day__title')).toHaveAttribute('lang', 'en');
  });

  test('reviewed Kiswahili notes are in the page language, with no English-only badge (L-113)', async ({ page }) => {
    await page.goto(`sw/${BUILD_DATE}/gospel/`);
    await expect(page.locator('.reading__summary')).toHaveText(/^Mwenye shamba anawalipa/);
    await expect(page.locator('.reading__summary')).not.toHaveAttribute('lang', /./);
    await expect(page.locator('.context__title')).toHaveText('Wafanyakazi katika shamba la mizabibu');
    await expect(page.locator('.note__summary').first()).not.toHaveAttribute('lang', /./);
    await expect(page.locator('.notes-lang')).toHaveCount(0);
    await page.goto(`sw/${BUILD_DATE}/gospel/notes/v15-evil-eye/`);
    await expect(page.locator('.insight__anchor')).toHaveText('“wivu”');
  });

  test('English pages add no lang to their own parts', async ({ page }) => {
    await page.goto(`${BUILD_DATE}/gospel/`);
    await expect(page.locator('.reading__summary')).not.toHaveAttribute('lang', /./);
    await expect(page.locator('.site-header .celebration')).not.toHaveAttribute('lang', /./);
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

  test('a saved language wins over the device-date switch on the Today page', async ({ page }) => {
    await page.goto('calendar/');
    await page.getByRole('link', { name: 'Kiswahili' }).click();
    await expect(page).toHaveURL(/\/lectio\/sw\/calendar\/$/);
    // The device is a day ahead of the build: the reader lands on that day, in Kiswahili.
    await page.clock.setFixedTime(new Date('2026-09-21T08:00:00+03:00'));
    await page.goto('');
    await expect(page).toHaveURL(/\/lectio\/sw\/2026-09-21\/$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'sw');
  });

  test('changing another setting never sends a Kiswahili Today link back to English', async ({ page }) => {
    await page.goto('settings/');
    await expect(page.locator('[data-settings-form]')).toHaveAttribute('data-ready', '');
    await page.getByRole('radio', { name: 'Dark' }).check();
    await expect(page.getByRole('status')).not.toBeEmpty();
    await page.goto('sw/');
    await expect(page).toHaveURL(/\/lectio\/sw\/$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'sw');
    // `/` stays English too: a stored default language is not a choice of another one.
    await page.goto('');
    await expect(page).toHaveURL(/\/lectio\/$/);
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

test.describe('Kiswahili API mirror (L-113)', () => {
  test('/api/v1/sw/ serves the reviewed Kiswahili notes', async ({ request }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'the API does not depend on the viewport');
    const day = (await (await request.get(`api/v1/sw/days/${BUILD_DATE}.json`)).json()) as {
      masses: { readings: { slot: string; passage: { locale: string } | null }[] }[];
    };
    const gospel = day.masses[0]?.readings.find((reading) => reading.slot === 'gospel');
    expect(gospel?.passage?.locale).toBe('sw');
    const passage = (await (await request.get('api/v1/sw/passages/MT.20.1-16.json')).json()) as {
      passage: { locale: string };
    };
    expect(passage.passage.locale).toBe('sw');
    for (const path of ['api/v1/sw/upcoming.json', 'api/v1/sw/passages/index.json', 'api/v1/sw/calendar/2026.json'])
      expect((await request.get(path)).ok(), path).toBe(true);
  });
});
