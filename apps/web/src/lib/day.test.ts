import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_CONFIG } from '@lectio/config';
import type { ContentRepo, ResolvedDay, ResolvedReading } from '@lectio/content';
import type { Passage } from '@lectio/schema/passage';
import { beforeAll, describe, expect, it } from 'vitest';

import { formatDate, t } from '../i18n/index.ts';
import {
  TODAY_DAYS_AHEAD,
  TODAY_DAYS_BEFORE,
  UPCOMING_LIST_DAYS,
  adjacentDates,
  calendarDates,
  colourLabel,
  dayPagePaths,
  dayPageView,
  dayPath,
  dayView,
  listenPath,
  rankLabel,
  refLabel,
  seasonLabel,
  slotLabel,
  slotOwners,
  todaySwitch,
  todaySwitchScript,
  todayWindowDates,
  upcomingDays,
} from './day.ts';
import type { DayConfig, DayEnv, TodaySwitch } from './day.ts';
import { siteContext } from './site.ts';

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, '../..');
const fixtureConfig = 'apps/web/test/lectio.config.fixture.json';

const env: DayEnv = {
  lang: 'en',
  messages: { t, formatDate: (locale, date) => formatDate(locale, date) },
  paths: (path) => `/base/${path}`,
};

function fixture() {
  return siteContext({ cwd: webRoot, env: { LECTIO_CONFIG: fixtureConfig } });
}

function withListen(config: DayConfig, listen: boolean): DayConfig {
  return { ...config, site: { ...config.site, features: { listen } } };
}

let context: ReturnType<typeof fixture>;

beforeAll(() => {
  context = fixture();
});

describe('paths', () => {
  it('builds day and listen paths relative to the locale root', () => {
    expect(dayPath('2026-09-20')).toBe('2026-09-20/');
    expect(listenPath('2026-09-20')).toBe('2026-09-20/listen/');
  });
});

describe('labels', () => {
  it('names every season, with the week when there is one', () => {
    expect(seasonLabel(env, 'ordinary-time', 25)).toBe('Ordinary Time · Week 25');
    expect(seasonLabel(env, 'lent', 0)).toBe('Lent');
    expect(
      ['advent', 'christmas', 'ordinary-time', 'lent', 'paschal-triduum', 'easter'].map((s) => seasonLabel(env, s, 0)),
    ).toEqual(['Advent', 'Christmas Time', 'Ordinary Time', 'Lent', 'Paschal Triduum', 'Easter Time']);
  });

  it('names every rank', () => {
    const ranks = ['solemnity', 'sunday', 'feast', 'memorial', 'optional-memorial', 'commemoration', 'weekday'];
    expect(ranks.map((rank) => rankLabel(env, rank))).toEqual([
      'Solemnity',
      'Sunday',
      'Feast',
      'Memorial',
      'Optional memorial',
      'Commemoration',
      'Weekday',
    ]);
  });

  it('names every liturgical colour', () => {
    const colours = ['white', 'red', 'green', 'violet', 'rose', 'black', 'gold'];
    expect(colours.map((colour) => colourLabel(env, colour))).toEqual([
      'White',
      'Red',
      'Green',
      'Violet',
      'Rose',
      'Black',
      'Gold',
    ]);
  });

  it('names named and numbered reading slots', () => {
    const slots = ['first-reading', 'psalm', 'second-reading', 'gospel', 'epistle', 'reading-3', 'psalm-2'];
    expect(slots.map((slot) => slotLabel(env, slot))).toEqual([
      'First reading',
      'Psalm',
      'Second reading',
      'Gospel',
      'Epistle',
      'Reading 3',
      'Psalm 2',
    ]);
    expect(slotLabel(env, 'responsory')).toBe('Reading');
  });

  it('writes references in full and keeps one that does not parse', () => {
    expect(refLabel('Mt 20:1-16a')).toBe('Matthew 20:1–16a');
    expect(refLabel('Ps 145:2-3, 8-9, 17-18')).toBe('Psalm 145:2–3, 8–9, 17–18');
    expect(refLabel('Nowhere 1:1')).toBe('Nowhere 1:1');
  });
});

describe('dayPageView with the fixture content root', () => {
  it('shows 2026-09-20 with its four readings, drbo link-outs, the Gospel page and the pending Isaiah note', () => {
    const view = dayPageView(env, context, '2026-09-20');
    expect(view).not.toBeNull();
    if (view === null) return;
    expect(view).toMatchObject({
      date: '2026-09-20',
      dateLabel: 'Sunday 20 September 2026',
      colour: 'green',
      title: 'Twenty-fifth Sunday in Ordinary Time',
      season: 'Ordinary Time · Week 25',
      cycles: 'Sunday cycle A · Weekday cycle II',
      massOptions: null,
      missing: null,
      listen: null,
      pageTitle: 'Twenty-fifth Sunday in Ordinary Time, Sunday 20 September 2026',
    });
    expect(view.celebrations).toEqual([
      { name: 'Twenty-fifth Sunday in Ordinary Time', rank: 'Sunday', colour: 'green', colourLabel: 'Green' },
    ]);
    const readings = view.masses[0]?.readings ?? [];
    expect(readings.map((reading) => reading.refLabel)).toEqual([
      'Isaiah 55:6–9',
      'Psalm 145:2–3, 8–9, 17–18',
      'Philippians 1:20c–24, 27a',
      'Matthew 20:1–16a',
    ]);
    for (const reading of readings) {
      expect(reading.linkout.href).toMatch(/^https:\/\/www\.drbo\.org\/chapter\/\d+\.htm$/);
      expect(reading.linkout.text).toBe('Text');
      expect(reading.linkout.detail).toBe(`${reading.refLabel} at Douay-Rheims (drbo.org) (opens in a new tab)`);
    }
    const [isaiah, , , gospel] = readings;
    expect(gospel).toMatchObject({ slotLabel: 'Gospel', href: '/base/2026-09-20/gospel/', pending: null });
    expect(gospel?.summary).toMatch(/landowner/);
    expect(isaiah).toMatchObject({ href: null, summary: null, pending: 'Notes in preparation' });
    expect(view.previous).toEqual({
      date: '2026-09-19',
      href: '/base/2026-09-19/',
      label: 'Previous day',
      dateLabel: 'Saturday 19 September 2026',
    });
    expect(view.next).toMatchObject({ date: '2026-09-21', href: '/base/2026-09-21/', label: 'Next day' });
    expect(view.description).toContain('Isaiah 55:6–9; Psalm 145:2–3, 8–9, 17–18;');
  });

  it('builds the meta description from the date, celebration, season and readings, in the page language', () => {
    const view = dayPageView(env, context, '2026-09-20');
    expect(view?.description).toMatch(
      /^Sunday 20 September 2026: Twenty-fifth Sunday in Ordinary Time\. Ordinary Time, Week 25\. Readings: Isaiah 55:6–9; /,
    );
    const sw = dayPageView({ ...env, lang: 'sw' }, context, '2026-09-20');
    expect(sw?.description).toMatch(
      /^Jumapili 20 Septemba 2026: Twenty-fifth Sunday in Ordinary Time\. Kipindi cha Kawaida, Juma la 25\. Masomo: Isaiah 55:6–9; /,
    );
    expect(sw?.season).toBe('Kipindi cha Kawaida · Juma la 25');
  });

  it('shows a day with no notes with every reference and link-out, and no Reading page links', () => {
    const view = dayPageView(env, context, '2026-09-19');
    const readings = view?.masses[0]?.readings ?? [];
    expect(readings.map((reading) => reading.refLabel)).toEqual([
      '1 Corinthians 15:35–37, 42–49',
      'Psalm 56:10–14',
      'Luke 8:4–15',
    ]);
    expect(readings.every((reading) => reading.href === null && reading.pending === 'Notes in preparation')).toBe(true);
    expect(readings.every((reading) => reading.linkout.href.startsWith('https://www.drbo.org/'))).toBe(true);
    expect(view?.previous).toBeNull();
    expect(view?.next?.date).toBe('2026-09-20');
  });

  it('has no next day at the end of the calendar, and the red of a feast', () => {
    const view = dayPageView(env, context, '2026-09-21');
    expect(view?.next).toBeNull();
    expect(view?.colour).toBe('red');
    expect(view?.celebrations[0]?.rank).toBe('Feast');
  });

  it('adds the Listen button only when features.listen is on', () => {
    const on = dayPageView(env, { ...context, config: withListen(context.config, true) }, '2026-09-20');
    expect(on?.listen).toEqual({ href: '/base/2026-09-20/listen/', label: 'Listen to the notes' });
    const off = dayPageView(env, { ...context, config: withListen(context.config, false) }, '2026-09-20');
    expect(off?.listen).toBeNull();
  });

  it('returns null for a date with no calendar day', () => {
    expect(dayPageView(env, context, '2026-01-01')).toBeNull();
  });
});

const PASSAGE = { summary: 'An approved summary.', review: { status: 'approved' } } as unknown as Passage;

function reading(slot: string, ref: string, approved = false): ResolvedReading {
  return {
    slot,
    ref,
    key: 'X.1.1',
    linkout: 'https://example.org/x',
    passage: approved ? PASSAGE : null,
    approved,
  } as unknown as ResolvedReading;
}

function day(overrides: Partial<ResolvedDay['day']>, masses: ResolvedDay['masses']): ResolvedDay {
  return {
    date: '2027-04-03',
    day: {
      date: '2027-04-03',
      season: 'paschal-triduum',
      seasonWeek: 0,
      sundayCycle: 'A',
      weekdayCycle: 'I',
      celebrations: [{ id: 'vigil', name: 'Easter Vigil', rank: 'solemnity', colour: 'white' }],
      masses: [],
      lectionaryMissing: false,
      ...overrides,
    },
    masses,
  } as ResolvedDay;
}

describe('dayView edge cases', () => {
  it("lists every Mass; with a Vigil and a Day Mass, the Day Mass owns the shared slot's Reading page", () => {
    const resolved = day(
      {
        celebrations: [
          { id: 'a', name: 'Saint A', rank: 'memorial', colour: 'red' },
          { id: 'b', name: 'Saint B', rank: 'optional-memorial', colour: 'white' },
        ],
      },
      [
        { id: 'vigil', label: 'Vigil Mass', readings: [reading('reading-1', 'Gn 1:1-2', true)] },
        {
          id: 'day',
          label: 'Mass during the Day',
          readings: [reading('reading-1', 'Gn 1:1-2', true), reading('epistle', 'Rom 6:3-11', true)],
        },
      ],
    );
    const view = dayView(env, resolved, { config: DEFAULT_CONFIG });
    expect(view.massOptions).toBe('This day has 2 Masses to choose from.');
    expect(view.masses.map((mass) => mass.label)).toEqual(['Vigil Mass', 'Mass during the Day']);
    expect(view.masses[0]?.readings[0]).toMatchObject({ slotLabel: 'Reading 1', href: null, pending: null });
    expect(view.masses[0]?.readings[0]?.summary).toBe('An approved summary.');
    expect(view.masses[1]?.readings[0]).toMatchObject({ href: '/base/2027-04-03/reading-1/' });
    expect(view.masses[1]?.readings[1]).toMatchObject({ slotLabel: 'Epistle', href: '/base/2027-04-03/epistle/' });
    expect(view.celebrations.map((c) => `${c.name} ${c.rank} ${c.colourLabel}`)).toEqual([
      'Saint A Memorial Red',
      'Saint B Optional memorial White',
    ]);
    expect(view.season).toBe('Paschal Triduum');
    expect(view.previous).toBeNull();
    expect(view.next).toBeNull();
  });

  it('gives each slot to the Day Mass when it uses it, otherwise to the first Mass that does', () => {
    const mass = (id: string, slots: string[]) => ({ id, readings: slots.map((slot) => ({ slot })) });
    const owners = slotOwners([
      mass('vigil', ['first-reading', 'psalm', 'gospel', 'epistle']),
      mass('night', ['first-reading', 'second-reading']),
      mass('day', ['first-reading', 'gospel']),
    ]);
    expect(Object.fromEntries(owners)).toEqual({
      'first-reading': 'day',
      gospel: 'day',
      psalm: 'vigil',
      epistle: 'vigil',
      'second-reading': 'night',
    });
    expect(Object.fromEntries(slotOwners([mass('a', ['gospel']), mass('b', ['gospel'])]))).toEqual({ gospel: 'a' });
  });

  it('drops an unapproved passage even when the reading claims to have one', () => {
    const sneaky = { ...reading('gospel', 'Mt 1:1', true), approved: false } as ResolvedReading;
    const view = dayView(env, day({}, [{ id: 'day', label: 'Mass', readings: [sneaky] }]), { config: DEFAULT_CONFIG });
    expect(view.masses[0]?.readings[0]).toMatchObject({ href: null, summary: null, pending: 'Notes in preparation' });
  });

  it('says the readings are not listed yet when the lectionary data is missing', () => {
    const view = dayView(env, day({ lectionaryMissing: true }, []), { config: DEFAULT_CONFIG });
    expect(view.masses).toEqual([]);
    expect(view.missing).toBe('The readings for this day are not listed yet.');
    expect(view.description).toBe(
      'Saturday 3 April 2027: Easter Vigil. Paschal Triduum. The readings for this day are not listed yet.',
    );
  });

  it('falls back to the date as the title when a day lists no celebration', () => {
    const view = dayView(env, day({ celebrations: [] }, []), { config: DEFAULT_CONFIG });
    expect(view.title).toBe('Saturday 3 April 2027');
    expect(view.colour).toBe('green');
  });
});

function stubRepo(dates: readonly string[]): Pick<ContentRepo, 'resolveDay' | 'listDays' | 'years' | 'calendarYear'> {
  const all = [...dates].sort();
  const make = (date: string) => day({ date, celebrations: [] }, []) as ResolvedDay & { date: string };
  return {
    resolveDay: (date) => (all.includes(date) ? { ...make(date), date } : null),
    listDays: (from, to) => all.filter((d) => d >= from && d <= to).map((date) => ({ ...make(date), date })),
    years: () => [...new Set(all.map((d) => Number(d.slice(0, 4))))],
    calendarYear: (year) =>
      year === 2099
        ? null
        : ({ days: all.filter((d) => d.startsWith(String(year))).map((date) => ({ date })) } as unknown as ReturnType<
            ContentRepo['calendarYear']
          >),
  };
}

describe('calendar dates and static paths', () => {
  it('lists every committed calendar date across years, in order', () => {
    const repo = stubRepo(['2027-01-01', '2026-12-31', '2026-12-30']);
    expect(calendarDates(repo)).toEqual(['2026-12-30', '2026-12-31', '2027-01-01']);
    expect(dayPagePaths(repo)).toEqual([
      { params: { date: '2026-12-30' } },
      { params: { date: '2026-12-31' } },
      { params: { date: '2027-01-01' } },
    ]);
  });

  it('skips a year whose calendar cannot be read', () => {
    const repo = { ...stubRepo(['2026-01-01']), years: () => [2026, 2099] };
    expect(calendarDates(repo)).toEqual(['2026-01-01']);
  });

  it('builds a static path for each fixture day', () => {
    expect(dayPagePaths(context.repo).map((path) => path.params.date)).toEqual([
      '2026-09-19',
      '2026-09-20',
      '2026-09-21',
    ]);
  });

  it('finds adjacent days across a year boundary', () => {
    expect(adjacentDates(stubRepo(['2026-12-31', '2027-01-01']), '2026-12-31')).toEqual({
      previous: null,
      next: '2027-01-01',
    });
  });
});

describe('the Today page', () => {
  it('knows the days from TODAY_DAYS_BEFORE before the build date to TODAY_DAYS_AHEAD - 1 after it', () => {
    const dates = Array.from({ length: 30 }, (_, i) => `2026-09-${String(i + 1).padStart(2, '0')}`);
    const window = todayWindowDates(stubRepo(dates), '2026-09-10');
    expect(window[0]).toBe('2026-09-08');
    expect(window).toHaveLength(TODAY_DAYS_BEFORE + TODAY_DAYS_AHEAD);
    expect(window.at(-1)).toBe('2026-09-23');
  });

  it('lists the upcoming days for the noscript fallback', () => {
    const days = upcomingDays(env, context.repo, '2026-09-20');
    expect(days).toEqual([
      {
        date: '2026-09-20',
        href: '/base/2026-09-20/',
        dateLabel: 'Sunday 20 September 2026',
        title: 'Twenty-fifth Sunday in Ordinary Time',
      },
      {
        date: '2026-09-21',
        href: '/base/2026-09-21/',
        dateLabel: 'Monday 21 September 2026',
        title: 'Saint Matthew, Apostle and Evangelist',
      },
    ]);
    const dates = Array.from({ length: 20 }, (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}`);
    const many = upcomingDays(env, stubRepo(dates), '2026-10-01');
    expect(many).toHaveLength(UPCOMING_LIST_DAYS);
    expect(many[0]?.title).toBe('Thursday 1 October 2026');
  });

  it('maps the dates around the build date to their day pages', () => {
    expect(todaySwitch(env, context.repo, '2026-09-20')).toEqual({
      buildDate: '2026-09-20',
      pages: {
        '2026-09-19': '/base/2026-09-19/',
        '2026-09-20': '/base/2026-09-20/',
        '2026-09-21': '/base/2026-09-21/',
      },
    });
  });

  it("adds every other locale's Today and day pages for the saved-language switch", () => {
    const data = todaySwitch(env, context.repo, '2026-09-20', {
      key: 'lectio.settings',
      locales: ['en', 'sw'],
      paths: (locale, path) => `/base/${locale === 'en' ? '' : `${locale}/`}${path}`,
    });
    expect(data.language).toEqual({
      key: 'lectio.settings',
      others: {
        sw: {
          home: '/base/sw/',
          pages: {
            '2026-09-19': '/base/sw/2026-09-19/',
            '2026-09-20': '/base/sw/2026-09-20/',
            '2026-09-21': '/base/sw/2026-09-21/',
          },
        },
      },
    });
  });

  describe('the inline script', () => {
    const data: TodaySwitch = {
      buildDate: '2026-09-20',
      pages: { '2026-09-20': '/base/2026-09-20/', '2026-09-21': '/base/2026-09-21/' },
    };

    function run(script: string, now: Date): string[] {
      const replaced: string[] = [];
      const RealDate = Date;
      class FakeDate extends RealDate {
        constructor() {
          super(now.getTime());
        }
      }
      new Function('Date', 'location', 'localStorage', script)(
        FakeDate,
        { replace: (href: string) => replaced.push(href) },
        storage,
      );
      return replaced;
    }

    let storage: { getItem(key: string): string | null } | undefined;
    const saved = (value: string | null) => {
      storage = { getItem: (key) => (key === 'lectio.settings' ? value : null) };
    };
    const withLanguage: TodaySwitch = {
      ...data,
      language: {
        key: 'lectio.settings',
        others: {
          sw: {
            home: '/base/sw/',
            pages: { '2026-09-20': '/base/sw/2026-09-20/', '2026-09-21': '/base/sw/2026-09-21/' },
          },
        },
      },
    };

    it('sends a reader who saved another language to its day page for the device date, or its Today', () => {
      saved(JSON.stringify({ language: 'sw' }));
      expect(run(todaySwitchScript(withLanguage), new Date(2026, 8, 21, 7, 30))).toEqual(['/base/sw/2026-09-21/']);
      expect(run(todaySwitchScript(withLanguage), new Date(2026, 8, 20, 7, 30))).toEqual(['/base/sw/']);
      expect(run(todaySwitchScript(withLanguage), new Date(2026, 9, 5, 9, 0))).toEqual(['/base/sw/']);
    });

    it('keeps the date switch without a saved other language, or when storage fails', () => {
      for (const value of [null, '{"language":"en"}', '{"language":"toString"}', '{"language":5}', '{bad']) {
        saved(value);
        expect(run(todaySwitchScript(withLanguage), new Date(2026, 8, 21, 7, 30))).toEqual(['/base/2026-09-21/']);
      }
      storage = {
        getItem: () => {
          throw new Error('SecurityError');
        },
      };
      expect(run(todaySwitchScript(withLanguage), new Date(2026, 8, 21, 7, 30))).toEqual(['/base/2026-09-21/']);
      storage = undefined;
    });

    it('moves to the day page for the device date when it differs and the site has it', () => {
      expect(run(todaySwitchScript(data), new Date(2026, 8, 21, 7, 30))).toEqual(['/base/2026-09-21/']);
    });

    it('stays when the device date is the build date', () => {
      expect(run(todaySwitchScript(data), new Date(2026, 8, 20, 23, 59))).toEqual([]);
    });

    it('stays when the site has no page for the device date', () => {
      expect(run(todaySwitchScript(data), new Date(2026, 9, 5, 9, 0))).toEqual([]);
    });

    it('escapes < so the data cannot close the script element', () => {
      const script = todaySwitchScript({ buildDate: '2026-09-20', pages: { x: '</script>' } });
      expect(script).not.toContain('</script>');
      expect(script).toContain('\\u003c/script>');
    });
  });
});
