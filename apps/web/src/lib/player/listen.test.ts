import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

import { formatDate, t } from '../../i18n/index.ts';
import type { DayEnv } from '../day.ts';
import { siteContext } from '../site.ts';
import { SPEEDS, dayApiPath, listenPagePaths, listenPageView, listenSegments } from './listen.ts';

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const BASE = '/lectio/';

const env = (lang: string): DayEnv => ({
  lang,
  messages: { t, formatDate: (locale, date) => formatDate(locale, date) },
  paths: (path) => `${BASE}${lang === 'en' ? '' : `${lang}/`}${path}`,
});

let context: ReturnType<typeof siteContext>;

beforeAll(() => {
  context = siteContext({ cwd: webRoot, env: { LECTIO_CONFIG: 'apps/web/test/lectio.config.fixture.json' } });
});

const IDS = ['MT.20.1-16/context', 'MT.20.1-16/note/v15-evil-eye', 'MT.20.1-16/note/v15-agathos'];

describe('listenPageView', () => {
  it('queues the Gospel’s context and notes for 2026-09-20, grouped under their reading', () => {
    const view = listenPageView(env('en'), { config: context.config, repo: context.repo, base: BASE }, '2026-09-20');
    expect(view).not.toBeNull();
    if (view === null) return;
    expect(view.data.tracks.map((track) => track.id)).toEqual(IDS);
    expect(
      view.data.tracks.every((track) => track.locale === 'en' && !track.fallback && track.lang === undefined),
    ).toBe(true);
    expect(view.data.tracks.every((track) => track.audio === null && track.script.length > 0)).toBe(true);
    expect(view.data.tracks[0]?.script).toMatch(/^Context for Matthew chapter 20, verses 1 to 16/);
    expect(view.groups).toEqual([
      { id: 'MT.20.1-16', heading: 'Gospel · Matthew 20:1–16a', start: 0, tracks: view.data.tracks },
    ]);
    expect(view).toMatchObject({
      pageTitle: 'Listen · Sunday 20 September 2026',
      description:
        'Listen to the context and original-language notes for the readings of Sunday 20 September 2026, one after another.',
      dayHref: '/lectio/2026-09-20/',
      backToDay: 'All readings for Sunday 20 September 2026',
      count: '3 notes',
    });
    expect(view.speeds.map((speed) => speed.label)).toEqual(['0.75×', '1×', '1.25×', '1.5×', '1.75×', '2×']);
    expect(view.data).toMatchObject({
      date: '2026-09-20',
      lang: 'en',
      api: '/lectio/api/v1/days/2026-09-20.json',
      album: 'Twenty-fifth Sunday in Ordinary Time, Sunday 20 September 2026',
      artwork: [
        { src: '/lectio/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/lectio/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      ],
    });
    expect(view.data.messages).toMatchObject({
      position: '{position} of {duration}',
      playing: 'Now playing: {title}',
      paused: 'Paused: {title}',
    });
    // Commentary only: the reading text is never queued (the pending Isaiah passage is left out too).
    expect(view.data.tracks.some((track) => track.id.startsWith('IS.'))).toBe(false);
  });

  it('queues the reviewed Kiswahili notes on a Kiswahili page, read in Kiswahili', () => {
    const view = listenPageView(
      env('sw'),
      { config: context.config, repo: context.repo, base: '/lectio' },
      '2026-09-20',
    );
    expect(view?.data.tracks.map((track) => [track.id, track.locale, track.fallback, track.lang])).toEqual(
      IDS.map((id) => [id, 'sw', false, undefined]),
    );
    expect(view?.data.api).toBe('/lectio/api/v1/sw/days/2026-09-20.json');
    expect(view?.pageTitle).toBe('Sikiliza · Jumapili 20 Septemba 2026');
    expect(view?.groups[0]?.heading).toMatch(/^Injili · /);
    expect(view?.count).toBe('madokezo 3');
  });

  it('stands the English notes in, marked, where there is no translation', () => {
    const view = listenPageView(
      env('sw'),
      { config: context.config, repo: context.repo, base: BASE, translations: () => null },
      '2026-09-20',
    );
    expect(view?.data.tracks.map((track) => [track.locale, track.fallback, track.lang])).toEqual(
      IDS.map(() => ['en', true, 'en']),
    );
  });

  it('shows an empty queue for a day without approved notes, and nothing for a date not in the calendar', () => {
    const view = listenPageView(env('en'), { config: context.config, repo: context.repo, base: BASE }, '2026-09-21');
    expect(view?.groups).toEqual([]);
    expect(view?.count).toBe('0 notes');
    expect(
      listenPageView(env('en'), { config: context.config, repo: context.repo, base: BASE }, '1900-01-01'),
    ).toBeNull();
  });
});

describe('listenSegments', () => {
  it('keeps English segments for a language without narration strings', () => {
    const day = context.repo.resolveDay('2026-09-20');
    if (day === null) throw new Error('fixture day missing');
    const segments = listenSegments(day, 'fr', 'en', () => null);
    expect(segments.map(({ segment, fallback }) => [segment.id, segment.locale, fallback])).toEqual(
      IDS.map((id) => [id, 'en', true]),
    );
  });
});

describe('paths', () => {
  it('builds the Listen pages only when the feature is on', () => {
    const on = { site: { ...context.config.site, features: { listen: true } } };
    const off = { site: { ...context.config.site, features: { listen: false } } };
    expect(listenPagePaths(['2026-09-20', '2026-09-21'], on)).toEqual([
      { params: { date: '2026-09-20' } },
      { params: { date: '2026-09-21' } },
    ]);
    expect(listenPagePaths(['2026-09-20'], off)).toEqual([]);
  });

  it('names the day API document of each locale', () => {
    expect(dayApiPath('2026-09-20', 'en', 'en')).toBe('api/v1/days/2026-09-20.json');
    expect(dayApiPath('2026-09-20', 'sw', 'en')).toBe('api/v1/sw/days/2026-09-20.json');
  });

  it('offers the speeds Settings offers', () => {
    expect(SPEEDS).toEqual([0.75, 1, 1.25, 1.5, 1.75, 2]);
  });
});
