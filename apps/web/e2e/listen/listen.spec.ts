/**
 * The Listen page (L-085) on the fixture build: the Gospel of 2026-09-20 has three narration segments (its context
 * and two translation notes). The day API document is answered with segment audio (`routeDay`): a real WAV for the
 * context, a missing file for the first note and none for the second, so one run covers recorded audio, the fallback
 * from a missing file to device speech, and device speech for a segment without a file. `speechSynthesis` is stubbed
 * (`stubSpeech`), so nothing depends on a real voice. The service worker is blocked so `page.route` sees every
 * request. The last test follows the segment audio the fixture build publishes (the L-082 audio manifest) to the player.
 */
import { AxeBuilder } from '@axe-core/playwright';
import type { Page } from '@playwright/test';

import { BUILD_DATE, EXPECTS_404, expect, test } from '../fixtures.ts';
import { removeSpeech, routeDay, serveAudio, spoken, stubSpeech, wav } from './fixtures.ts';

const LISTEN = `${BUILD_DATE}/listen/`;
const CONTEXT = 'MT.20.1-16/context';
const EVIL_EYE = 'MT.20.1-16/note/v15-evil-eye';
const AGATHOS = 'MT.20.1-16/note/v15-agathos';

test.use({ serviceWorkers: 'block' });

/** Opens a Listen page and waits until the player is wired and has looked up its audio. */
async function openListen(page: Page, path = LISTEN): Promise<void> {
  await page.goto(path);
  await expect(page.locator('[data-listen][data-ready][data-audio-ready]')).toBeAttached();
}

const current = (page: Page) => page.locator('[data-track][aria-current="true"]');

test('the Day page links to the Listen page', async ({ page }) => {
  await page.goto(`${BUILD_DATE}/`);
  await page.getByRole('link', { name: 'Listen to the notes' }).click();
  await expect(page).toHaveURL(new RegExp(`${LISTEN}$`));
  await expect(page.getByRole('heading', { level: 1, name: 'Listen' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 3, name: /^Gospel · Matthew 20:1/ })).toBeVisible();
  await expect(page.locator('[data-track]')).toHaveCount(3);
});

test(
  'plays the recorded file, advances, and falls back to device speech for a missing file',
  { tag: EXPECTS_404 },
  async ({ page }) => {
    await stubSpeech(page);
    await serveAudio(page);
    await routeDay(page, `api/v1/days/${BUILD_DATE}.json`, 'en', {
      [CONTEXT]: 'present.wav',
      [EVIL_EYE]: 'missing.wav',
      [AGATHOS]: null,
    });
    await openListen(page);

    const toggle = page.locator('[data-toggle]');
    await expect(toggle).toHaveAccessibleName('Play');
    await toggle.click();
    await expect(toggle).toHaveAccessibleName('Pause');
    await expect(page.locator('[data-source]')).toHaveText('Recorded narration');
    await expect(page.locator('[data-announce]')).toHaveText(/^Now playing: /);
    const metadata = await page.evaluate(() => navigator.mediaSession.metadata?.title ?? null);
    expect(metadata).toBe(await page.locator('[data-now-title]').textContent());

    // The WAV ends; the first note's file is missing, so the device voice reads it in English.
    await expect(current(page)).toHaveAttribute('data-track', '1', { timeout: 10_000 });
    await expect(page.locator('[data-source]')).toHaveText(/recording could not be played/);
    // Then the second note, which has no file at all, and the end of the queue.
    await expect(current(page)).toHaveAttribute('data-track', '2', { timeout: 10_000 });
    await expect(page.locator('[data-announce]')).toHaveText(/heard every note/, { timeout: 10_000 });
    await expect(toggle).toHaveAccessibleName('Play');

    const said = await spoken(page);
    expect(said.length).toBeGreaterThan(1);
    expect(said.every((utterance) => utterance.lang === 'en-GB' && utterance.voice === 'Stub English')).toBe(true);
    expect(said[0]?.text).toMatch(/^Translation note on Matthew chapter 20, verse 15/);

    // The file that played was kept for offline listening, where Clear offline data finds it.
    const cached = await page.evaluate(async () =>
      (await (await caches.open('lectio-data-audio')).keys()).map((request) => new URL(request.url).pathname),
    );
    expect(cached).toEqual(['/lectio/__e2e__/audio/present.wav']);
  },
);

test('changes and keeps the speed, answers the keyboard and resumes where it stopped', async ({ page }) => {
  // A long utterance, so the queue only moves when the test moves it.
  await stubSpeech(page, 60_000);
  await routeDay(page, `api/v1/days/${BUILD_DATE}.json`, 'en', {});
  await openListen(page);

  await page.getByLabel('Speed').selectOption('1.5');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('lectio.settings') ?? '{}') as unknown);
  expect(saved).toMatchObject({ playbackSpeed: 1.5 });

  await page.locator('[data-toggle]').click();
  await expect(page.locator('[data-source]')).toHaveText("Read by your device's voice");
  await expect.poll(async () => (await spoken(page)).at(-1)?.rate).toBe(1.5);

  // Shortcuts act from anywhere on the page except form fields.
  await page.locator('h1').click();
  await page.keyboard.press('Shift+N');
  await expect(current(page)).toHaveAttribute('data-track', '1');
  await page.keyboard.press('>');
  await expect(page.getByLabel('Speed')).toHaveValue('1.75');
  await expect.poll(async () => (await spoken(page)).at(-1)?.rate).toBe(1.75);
  await page.keyboard.press('k');
  await expect(page.locator('[data-toggle]')).toHaveAccessibleName('Play');
  await expect(page.locator('[data-announce]')).toHaveText(/^Paused: /);

  // Space on a focused queue item plays that item (the button's own activation), not the toggle shortcut.
  await page.locator('[data-track="2"]').focus();
  await page.keyboard.press('Space');
  await expect(current(page)).toHaveAttribute('data-track', '2');
  await expect(page.locator('[data-track="2"]')).toBeFocused();
  await page.keyboard.press('k');
  await expect(page.locator('[data-toggle]')).toHaveAccessibleName('Play');

  await page.reload();
  await expect(page.locator('[data-listen][data-ready]')).toBeAttached();
  await expect(current(page)).toHaveAttribute('data-track', '2');
  await expect(page.getByLabel('Speed')).toHaveValue('1.75');

  // Space plays only with focus in the player; elsewhere it is left to scroll the page.
  await page.locator('h1').click();
  await page.keyboard.press('Space');
  await expect(page.locator('[data-toggle]')).toHaveAccessibleName('Play');
  await page.locator('[data-now-title]').click();
  await page.keyboard.press('Space');
  await expect(page.locator('[data-toggle]')).toHaveAccessibleName('Pause');
});

test('says so, points to the notes and keeps every control inert when nothing can play', async ({ page }) => {
  await removeSpeech(page);
  await routeDay(page, `api/v1/days/${BUILD_DATE}.json`, 'en', {});
  await openListen(page);
  const notice = page.locator('[data-unavailable]');
  await expect(notice).toBeVisible();
  await expect(notice).toContainText('This browser cannot play the notes aloud.');
  await expect(notice.getByRole('link', { name: /^All readings for / })).toHaveAttribute(
    'href',
    `/lectio/${BUILD_DATE}/`,
  );
  for (const selector of [
    '[data-toggle]',
    '[data-back]',
    '[data-forward]',
    '[data-previous]',
    '[data-next]',
    '[data-track="1"]',
  ])
    await expect(page.locator(selector)).toHaveAttribute('aria-disabled', 'true');
  await expect(page.locator('[data-seek]')).toBeDisabled();

  // Playwright will not click an aria-disabled control on its own: force the clicks a reader could still make.
  await page.locator('[data-toggle]').click({ force: true });
  await page.locator('[data-track="1"]').click({ force: true });
  await page.keyboard.press('k');
  await expect(page.locator('[data-toggle]')).toHaveAccessibleName('Play');
  await expect(current(page)).toHaveAttribute('data-track', '0');

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(results.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact ?? ''))).toEqual(
    [],
  );
});

test('reads Kiswahili notes with a Kiswahili voice on the /sw/ page', async ({ page }) => {
  await stubSpeech(page, 60_000);
  await routeDay(page, `api/v1/sw/days/${BUILD_DATE}.json`, 'sw', {});
  await openListen(page, `sw/${LISTEN}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Sikiliza' })).toBeVisible();
  await page.getByRole('button', { name: 'Cheza', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sitisha', exact: true })).toBeVisible();
  await expect.poll(async () => (await spoken(page)).at(-1)).toMatchObject({ lang: 'sw-KE', voice: 'Stub Kiswahili' });
});

test('plays the narration files the fixture build publishes (audio manifest, L-082)', async ({ page }) => {
  await stubSpeech(page);
  // The fixture manifest's URLs point at https://audio.lectio.test/<key>. Its WAV files are 1 kHz placeholders that
  // Chromium will not decode, so every URL in the manifest is answered with a decodable WAV of the same kind: this
  // checks that the API's segment audio reaches the player, not the placeholder files themselves.
  const requested: string[] = [];
  const file = wav(0.3);
  await page.route('https://audio.lectio.test/**', async (route) => {
    requested.push(new URL(route.request().url()).pathname);
    await route.fulfill({
      status: 200,
      contentType: 'audio/wav',
      headers: { 'access-control-allow-origin': '*' },
      body: file,
    });
  });
  await openListen(page);
  await page.locator('[data-toggle]').click();
  await expect(page.locator('[data-source]')).toHaveText('Recorded narration');
  await expect(page.locator('[data-announce]')).toHaveText(/heard every note/, { timeout: 10_000 });
  expect(await spoken(page)).toEqual([]);
  expect(new Set(requested).size).toBe(3);
  expect(requested.every((path) => /^\/audio\/en\/[0-9a-f]{64}\.wav$/.test(path))).toBe(true);
});
