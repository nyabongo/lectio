import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openRepo } from '@lectio/content';
import type { ContentFs, ContentRepo } from '@lectio/content';
import type { CalendarDay, CalendarYear } from '@lectio/schema/calendar';
import type { Passage, TranslationNote } from '@lectio/schema/passage';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_WEEK_START,
  calendarIndex,
  calendarMonths,
  colourLabels,
  colourDotCss,
  currentMonth,
  dayPath,
  daysInMonth,
  isoDate,
  monthDate,
  monthPath,
  monthStaticPaths,
  monthView,
  noteCount,
  passageLibrary,
  passagePath,
  passageStaticPaths,
  passageView,
  readingPath,
  textDirection,
  weekday,
} from './calendar-view.ts';
import type { CalendarCell } from './calendar-view.ts';
import { siteContext } from './site.ts';

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, '../..');
const fixtureRoot = resolve(webRoot, 'test/fixtures/content');
const APPROVED = 'MT.20.1-16';
const PENDING = 'IS.55.6-9';

function readJson<T>(relative: string): T {
  return JSON.parse(readFileSync(resolve(fixtureRoot, relative), 'utf8')) as T;
}

const fixtureCalendar = readJson<CalendarYear>('calendar/2026.json');
const approvedPassage = readJson<Passage>(`passages/${APPROVED}.json`);
const pendingPassage = readJson<Passage>(`passages/${PENDING}.json`);
const [saturday, sunday, feast] = fixtureCalendar.days as [CalendarDay, CalendarDay, CalendarDay];

function fixtureRepo(): ContentRepo {
  return siteContext({ cwd: webRoot, env: { LECTIO_CONFIG: 'apps/web/test/lectio.config.fixture.json' } }).repo;
}

/** An in-memory repository at `/mem`: `files` maps repository-relative paths to JSON values. */
function memoryRepo(files: Readonly<Record<string, unknown>>): ContentRepo {
  const texts = Object.fromEntries(Object.entries(files).map(([path, value]) => [path, JSON.stringify(value)]));
  const fs: ContentFs = {
    readFile: (path) => {
      const text = texts[path.replace(/^\/mem\//, '')];
      if (text === undefined) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      return text;
    },
    readdir: (path) => {
      const dir = `${path.replace(/^\/mem\/?/, '')}/`;
      return Object.keys(texts)
        .filter((file) => file.startsWith(dir))
        .map((file) => file.slice(dir.length));
    },
  };
  return openRepo('/mem', { fs });
}

/** A day modelled on a fixture day, moved to `date`. */
function dayOn(date: string, model: CalendarDay = saturday): CalendarDay {
  return { ...model, date };
}

/** Every day of September 2026: fixture Sundays on Sundays, the feast on the 21st, a white solemnity on the 8th. */
function septemberDays(): CalendarDay[] {
  return Array.from({ length: 30 }, (_, index) => {
    const date = isoDate(2026, 9, index + 1);
    if (date === '2026-09-21') return feast;
    if (date === '2026-09-08')
      return {
        ...saturday,
        date,
        celebrations: [
          { id: 'nativity-of-mary', name: 'Nativity of the Blessed Virgin Mary', rank: 'feast', colour: 'white' },
        ],
      };
    if (weekday(date) === 0) return dayOn(date, sunday);
    return dayOn(date);
  });
}

function calendar(year: number, days: CalendarDay[]): CalendarYear {
  return { ...fixtureCalendar, year, days };
}

function fullSeptemberRepo(extra: Readonly<Record<string, unknown>> = {}): ContentRepo {
  return memoryRepo({
    'calendar/2026.json': calendar(2026, septemberDays()),
    [`passages/${APPROVED}.json`]: approvedPassage,
    [`passages/${PENDING}.json`]: pendingPassage,
    ...extra,
  });
}

function cells(view: ReturnType<typeof monthView>): CalendarCell[] {
  return view.weeks.flat().filter((cell): cell is CalendarCell => cell !== null);
}

describe('date helpers and paths', () => {
  it('builds ISO dates, month lengths and weekdays', () => {
    expect(isoDate(2026, 9, 5)).toBe('2026-09-05');
    expect(daysInMonth(2026, 9)).toBe(30);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2026, 12)).toBe(31);
    expect(weekday('2026-09-20')).toBe(0);
    expect(weekday('2026-09-19')).toBe(6);
  });

  it('writes root-relative site paths', () => {
    expect(dayPath('2026-09-20')).toBe('2026-09-20/');
    expect(readingPath('2026-09-20', 'gospel')).toBe('2026-09-20/gospel/');
    expect(monthPath({ year: 2026, month: 9 })).toBe('calendar/2026/09/');
    expect(monthPath({ year: 2026, month: 12 })).toBe('calendar/2026/12/');
    expect(passagePath(APPROVED)).toBe('passages/MT.20.1-16/');
    expect(monthDate({ year: 2026, month: 9 })).toBe('2026-09-01');
  });
});

describe('months and the archive index', () => {
  it('gives every committed year twelve months, in order', () => {
    const repo = memoryRepo({
      'calendar/2027.json': calendar(2027, []),
      'calendar/2026.json': calendar(2026, [sunday]),
    });
    const months = calendarMonths(repo);
    expect(months).toHaveLength(24);
    expect(months[0]).toEqual({ year: 2026, month: 1 });
    expect(months.at(-1)).toEqual({ year: 2027, month: 12 });
    expect(monthStaticPaths(repo)[8]).toEqual({
      params: { yyyy: '2026', mm: '09' },
      props: { id: { year: 2026, month: 9 } },
    });
  });

  it('points /calendar/ at the build month, else the nearest month with a page', () => {
    const repo = memoryRepo({
      'calendar/2026.json': calendar(2026, [sunday]),
      'calendar/2027.json': calendar(2027, []),
    });
    expect(currentMonth(repo, '2026-09-20')).toEqual({ year: 2026, month: 9 });
    expect(currentMonth(repo, '2027-03-01')).toEqual({ year: 2027, month: 3 });
    expect(currentMonth(repo, '2025-06-01')).toEqual({ year: 2026, month: 1 });
    expect(currentMonth(repo, '2030-06-01')).toEqual({ year: 2027, month: 12 });
    expect(currentMonth(memoryRepo({}), '2026-09-20')).toBeNull();
  });

  it('lists every year with its months and the current one', () => {
    const view = calendarIndex(fixtureRepo(), '2026-09-20');
    expect(view.current).toEqual({ id: { year: 2026, month: 9 }, path: 'calendar/2026/09/', date: '2026-09-01' });
    expect(view.years.map((year) => year.year)).toEqual([2026]);
    expect(view.years[0]?.months.map((month) => month.path)).toContain('calendar/2026/01/');
    expect(view.years[0]?.months).toHaveLength(12);
    expect(calendarIndex(memoryRepo({}), '2026-09-20')).toEqual({ current: null, years: [] });
  });
});

describe('monthView', () => {
  it('links every day of September 2026 when the calendar has the whole month', () => {
    const view = monthView(fullSeptemberRepo(), { year: 2026, month: 9 }, { today: '2026-09-20' });
    const days = cells(view);
    expect(days).toHaveLength(30);
    expect(days.map((cell) => cell.path)).toEqual(
      Array.from({ length: 30 }, (_, index) => `${isoDate(2026, 9, index + 1)}/`),
    );
    expect(days.every((cell) => cell.colour !== null && cell.celebration !== null)).toBe(true);
    expect(view.dayCount).toBe(30);
  });

  it('lays the month out in Monday-first weeks of seven', () => {
    expect(DEFAULT_WEEK_START).toBe(1);
    const view = monthView(fullSeptemberRepo(), { year: 2026, month: 9 });
    // 1 September 2026 is a Tuesday: one empty cell before it, and the 30th (a Wednesday) leaves four after it.
    expect(view.weeks).toHaveLength(5);
    expect(view.weeks.every((week) => week.length === 7)).toBe(true);
    expect(view.weeks[0]?.[0]).toBeNull();
    expect(view.weeks[0]?.[1]?.date).toBe('2026-09-01');
    expect(view.weeks[4]?.slice(3)).toEqual([null, null, null, null]);
    expect(view.weekdays).toEqual([
      '2026-08-31',
      '2026-09-01',
      '2026-09-02',
      '2026-09-03',
      '2026-09-04',
      '2026-09-05',
      '2026-09-06',
    ]);
    expect(view.weekdays.map(weekday)).toEqual([1, 2, 3, 4, 5, 6, 0]);
  });

  it('can start weeks on Sunday', () => {
    const view = monthView(fullSeptemberRepo(), { year: 2026, month: 9 }, { weekStart: 0 });
    expect(view.weekdays.map(weekday)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(view.weeks[0]?.slice(0, 3).map((cell) => cell?.date ?? null)).toEqual([null, null, '2026-09-01']);
    // A month starting on the first column has no leading padding (November 2026 starts on a Sunday).
    expect(monthView(fullSeptemberRepo(), { year: 2026, month: 11 }, { weekStart: 0 }).weeks[0]?.[0]?.date).toBe(
      '2026-11-01',
    );
  });

  it('marks colour, celebration, listed ranks and today on each cell', () => {
    const view = monthView(fullSeptemberRepo(), { year: 2026, month: 9 }, { today: '2026-09-20' });
    const byDate = new Map(cells(view).map((cell) => [cell.date, cell]));
    expect(byDate.get('2026-09-20')).toEqual({
      date: '2026-09-20',
      day: 20,
      path: '2026-09-20/',
      colour: 'green',
      celebration: 'Twenty-fifth Sunday in Ordinary Time',
      listed: true,
      today: true,
    });
    expect(byDate.get('2026-09-21')).toMatchObject({ colour: 'red', listed: true, today: false });
    expect(byDate.get('2026-09-08')).toMatchObject({ colour: 'white', listed: true });
    expect(byDate.get('2026-09-19')).toMatchObject({ colour: 'green', listed: false });
    expect(cells(view).filter((cell) => cell.today)).toHaveLength(1);
  });

  it('lists the month’s Sundays, feasts and solemnities in date order', () => {
    const view = monthView(fullSeptemberRepo(), { year: 2026, month: 9 });
    expect(view.celebrations.map((item) => `${item.date} ${item.rank} ${item.colour}`)).toEqual([
      '2026-09-06 sunday green',
      '2026-09-08 feast white',
      '2026-09-13 sunday green',
      '2026-09-20 sunday green',
      '2026-09-21 feast red',
      '2026-09-27 sunday green',
    ]);
    expect(view.celebrations[4]).toEqual({
      date: '2026-09-21',
      path: '2026-09-21/',
      name: 'Saint Matthew, Apostle and Evangelist',
      rank: 'feast',
      colour: 'red',
    });
  });

  it('links only the days the calendar has (the fixture has three)', () => {
    const view = monthView(fixtureRepo(), { year: 2026, month: 9 });
    const linked = cells(view).filter((cell) => cell.path !== null);
    expect(linked.map((cell) => cell.date)).toEqual(['2026-09-19', '2026-09-20', '2026-09-21']);
    const missing = cells(view).find((cell) => cell.date === '2026-09-01');
    expect(missing).toEqual({
      date: '2026-09-01',
      day: 1,
      path: null,
      colour: null,
      celebration: null,
      listed: false,
      today: false,
    });
    expect(view.dayCount).toBe(3);
  });

  it('links prev and next months across years and stops at the ends', () => {
    const repo = memoryRepo({
      'calendar/2026.json': calendar(2026, [sunday]),
      'calendar/2027.json': calendar(2027, []),
    });
    const september = monthView(repo, { year: 2026, month: 9 });
    expect(september.prev).toEqual({ id: { year: 2026, month: 8 }, path: 'calendar/2026/08/', date: '2026-08-01' });
    expect(september.next?.path).toBe('calendar/2026/10/');
    expect(monthView(repo, { year: 2026, month: 12 }).next?.path).toBe('calendar/2027/01/');
    expect(monthView(repo, { year: 2026, month: 1 }).prev).toBeNull();
    expect(monthView(repo, { year: 2027, month: 12 }).next).toBeNull();
    const empty = monthView(repo, { year: 2027, month: 5 });
    expect(empty.dayCount).toBe(0);
    expect(empty.celebrations).toEqual([]);
    // A month outside the committed years has no neighbours.
    const outside = monthView(repo, { year: 2030, month: 5 });
    expect(outside.prev).toBeNull();
    expect(outside.next).toBeNull();
  });

  it('rejects a month outside 1–12', () => {
    const repo = fullSeptemberRepo();
    expect(() => monthView(repo, { year: 2026, month: 0 })).toThrow(RangeError);
    expect(() => monthView(repo, { year: 2026, month: 13 })).toThrow('month must be 1–12');
    expect(() => monthView(repo, { year: 2026, month: 1.5 })).toThrow(RangeError);
  });
});

describe('colour labels and text direction', () => {
  it('names every liturgical colour', () => {
    expect(colourLabels('en')).toEqual({
      green: 'Green',
      violet: 'Violet',
      white: 'White',
      gold: 'Gold',
      red: 'Red',
      rose: 'Rose',
      black: 'Black',
    });
  });

  it('writes Hebrew and Aramaic right to left', () => {
    expect(textDirection('hbo')).toBe('rtl');
    expect(textDirection('arc')).toBe('rtl');
    expect(textDirection('grc')).toBe('ltr');
    expect(textDirection('lat')).toBe('ltr');
  });
});

describe('colourDotCss', () => {
  it('styles a dot for every colour in light, dark and forced-dark schemes', () => {
    const css = colourDotCss();
    for (const colour of ['green', 'violet', 'white', 'gold', 'red', 'rose', 'black']) {
      expect(css).toContain(`:root .colour-dot[data-colour="${colour}"]`);
      expect(css).toContain(`:root:not([data-theme="light"]) .colour-dot[data-colour="${colour}"]`);
      expect(css).toContain(`:root[data-theme="dark"] .colour-dot[data-colour="${colour}"]`);
    }
    expect(css).toContain('@media (prefers-color-scheme: dark)');
    // White is drawn white, not in its gold accent; gold keeps the accent.
    expect(css).toContain(':root .colour-dot[data-colour="white"]{background:#ffffff;}');
    expect(css).toContain(':root[data-theme="dark"] .colour-dot[data-colour="white"]{background:#f7f2e8;}');
    expect(css).toContain(':root .colour-dot[data-colour="gold"]{background:#94681c;}');
  });
});

describe('passageLibrary', () => {
  it('lists only approved passages from the fixture, by book, with note counts', () => {
    const view = passageLibrary(fixtureRepo());
    expect(view).toEqual({
      books: [
        {
          code: 'MT',
          name: 'Matthew',
          testament: 'NT',
          noteCount: 3,
          passages: [
            {
              key: APPROVED,
              ref: 'Matthew 20:1–16a',
              path: 'passages/MT.20.1-16/',
              contextTitle: 'Labourers in the vineyard',
              noteCount: 3,
              dateCount: 1,
            },
          ],
        },
      ],
      passageCount: 1,
      noteCount: 3,
    });
    expect(noteCount(approvedPassage)).toBe(1 + approvedPassage.translationNotes.length);
  });

  it('orders books canonically and passages by chapter and verse', () => {
    const isaiah: Passage = { ...approvedPassage, key: PENDING, ref: 'Is 55:6-9', review: approvedPassage.review };
    const earlyMatthew: Passage = { ...approvedPassage, key: 'MT.5.1-12', ref: 'Mt 5:1-12a', translationNotes: [] };
    const sameChapter: Passage = { ...approvedPassage, key: 'MT.20.17-19', ref: 'Mt 20:17-19', translationNotes: [] };
    const psalm: Passage = { ...approvedPassage, key: 'PS.23', ref: 'Ps 23', translationNotes: [] };
    const repo = memoryRepo({
      'calendar/2026.json': calendar(2026, septemberDays()),
      [`passages/${APPROVED}.json`]: approvedPassage,
      [`passages/${PENDING}.json`]: isaiah,
      'passages/MT.5.1-12.json': earlyMatthew,
      'passages/MT.20.17-19.json': sameChapter,
      'passages/PS.23.json': psalm,
    });
    const view = passageLibrary(repo);
    expect(view.books.map((book) => `${book.testament} ${book.name}`)).toEqual([
      'OT Psalms',
      'OT Isaiah',
      'NT Matthew',
    ]);
    expect(view.books[0]?.passages[0]?.ref).toBe('Psalm 23');
    expect(view.books[2]?.passages.map((passage) => passage.key)).toEqual(['MT.5.1-12', APPROVED, 'MT.20.17-19']);
    expect(view.books[2]?.noteCount).toBe(5);
    expect(view.passageCount).toBe(5);
    expect(view.noteCount).toBe(9);
    // The full September calendar reads the Gospel on each Sunday.
    expect(view.books[2]?.passages[1]?.dateCount).toBe(4);
  });

  it('is empty when no passage is approved', () => {
    expect(passageLibrary(memoryRepo({ [`passages/${PENDING}.json`]: pendingPassage }))).toEqual({
      books: [],
      passageCount: 0,
      noteCount: 0,
    });
  });

  it('keeps the stored reference when it cannot be parsed', () => {
    const odd: Passage = { ...approvedPassage, ref: 'Matthew, the vineyard' };
    const view = passageLibrary(memoryRepo({ [`passages/${APPROVED}.json`]: odd }));
    expect(view.books[0]?.passages[0]?.ref).toBe('Matthew, the vineyard');
  });
});

describe('passageView', () => {
  it('lists note titles, never bodies, and every date with its Reading page', () => {
    const view = passageView(fullSeptemberRepo(), APPROVED, '2026-09-20');
    expect(view).not.toBeNull();
    expect(view?.ref).toBe('Matthew 20:1–16a');
    expect(view?.summary).toBe(approvedPassage.summary);
    expect(view?.contextTitle).toBe('Labourers in the vineyard');
    expect(view?.noteCount).toBe(3);
    expect(view?.lastReviewedAt).toBe('2026-09-03T17:05:00Z');
    expect(view?.notes).toEqual(
      approvedPassage.translationNotes.map((note: TranslationNote) => ({
        id: note.id,
        verse: note.verse,
        anchor: note.anchor,
        original: {
          text: note.original.text,
          lang: note.original.lang,
          dir: 'ltr',
          translit: note.original.translit,
        },
      })),
    );
    const serialised = JSON.stringify(view);
    for (const note of approvedPassage.translationNotes) expect(serialised).not.toContain(note.body);
    for (const paragraph of approvedPassage.context.paragraphs) expect(serialised).not.toContain(paragraph);
    expect(view?.appearances.map((item) => item.path)).toEqual([
      '2026-09-06/gospel/',
      '2026-09-13/gospel/',
      '2026-09-20/gospel/',
      '2026-09-27/gospel/',
    ]);
    expect(view?.appearances[2]).toEqual({
      date: '2026-09-20',
      path: '2026-09-20/gospel/',
      dayPath: '2026-09-20/',
      celebration: 'Twenty-fifth Sunday in Ordinary Time',
      colour: 'green',
      today: true,
    });
  });

  it('works on the fixture content root', () => {
    const view = passageView(fixtureRepo(), APPROVED);
    expect(view?.appearances.map((item) => [item.date, item.today])).toEqual([['2026-09-20', false]]);
    expect(passageStaticPaths(fixtureRepo())).toEqual([{ params: { key: APPROVED } }]);
  });

  it('is null for pending or missing passages', () => {
    const repo = fixtureRepo();
    expect(passageView(repo, PENDING)).toBeNull();
    expect(passageView(repo, 'JN.1.1-5')).toBeNull();
  });

  it('skips dates whose day or reading the calendar no longer has', () => {
    const repo = fullSeptemberRepo();
    const lagging: ContentRepo = {
      ...repo,
      // A stale index: one date outside the calendar, one whose day does not read the passage.
      datesForPassage: () => ['2025-01-01', '2026-09-19', '2026-09-20'],
      resolveDay: (date) => {
        const day = repo.resolveDay(date);
        return day === null || date !== '2026-09-20' ? day : { ...day, day: { ...day.day, celebrations: [] } };
      },
    };
    const view = passageView(lagging, APPROVED);
    expect(view?.appearances.map((item) => [item.date, item.celebration, item.colour])).toEqual([
      ['2026-09-20', null, 'green'],
    ]);
  });

  it('copes with a passage that is in no calendar and a missing review date', () => {
    const { lastReviewedAt: _dropped, ...review } = approvedPassage.review;
    const undated: Passage = { ...approvedPassage, review };
    const view = passageView(memoryRepo({ [`passages/${APPROVED}.json`]: undated }), APPROVED);
    expect(view?.appearances).toEqual([]);
    expect(view?.lastReviewedAt).toBeNull();
  });
});
