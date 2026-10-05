/**
 * View models for the calendar/archive (`/calendar/`, `/calendar/<yyyy>/<mm>/`) and the passage library
 * (`/passages/`, `/passages/<key>/`). Pure functions over the content repository, so the pages only format and
 * lay out what these return.
 *
 * Paths are root-relative without a leading slash (`2026-09-20/`, `calendar/2026/09/`, `passages/MT.20.1-16/`);
 * pages prefix them with `localePath` and `withBase`. Every interface is spelled out here so `.astro` files never
 * touch the deep schema types, which `astro check` cannot resolve (see `readingSummaries` in site.ts).
 *
 * Only approved passages reach the library, as everywhere else on the site (`isApproved` from `@lectio/content`),
 * and a passage page lists note titles, never note bodies: the full notes live on the Reading pages it links to.
 */
import { isApproved } from '@lectio/content';
import type { ContentRepo, ResolvedDay } from '@lectio/content';
import { formatRef, fromKey, getBook, tryParseRef } from '@lectio/refs';
import type { Ref } from '@lectio/refs';
import type { Celebration, Reading } from '@lectio/schema/calendar';
import type { LiturgicalColour } from '@lectio/schema/common';
import type { Passage, TranslationNote } from '@lectio/schema/passage';
import { addDays } from '@lectio/shared';
import type { IsoDate } from '@lectio/shared';

import { ACCENTS, SCHEMES, dayColour } from './theme.ts';
import type { Scheme } from './theme.ts';

/** A calendar month: `month` is 1–12. */
export interface MonthId {
  readonly year: number;
  readonly month: number;
}

/** Ranks whose celebrations a month page lists under the grid (weekdays and optional memorials are left out). */
export const LISTED_RANKS: ReadonlySet<string> = new Set(['solemnity', 'sunday', 'feast', 'memorial']);

/** `0` Sunday … `6` Saturday. British English weeks start on Monday. */
export const DEFAULT_WEEK_START = 1;

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** The ISO date of `day` in a month. */
export function isoDate(year: number, month: number, day: number): IsoDate {
  return `${String(year)}-${pad(month)}-${pad(day)}`;
}

/** Days in `month` of `year` (leap years included). */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Day of the week of an ISO date: `0` Sunday … `6` Saturday. */
export function weekday(date: IsoDate): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** The site path of a day page: `2026-09-20/`. */
export function dayPath(date: IsoDate): string {
  return `${date}/`;
}

/** The site path of a Reading page: `2026-09-20/gospel/`. */
export function readingPath(date: IsoDate, slot: string): string {
  return `${date}/${slot}/`;
}

/** The site path of a month page: `calendar/2026/09/`. */
export function monthPath({ year, month }: MonthId): string {
  return `calendar/${String(year)}/${pad(month)}/`;
}

/** The site path of a passage page: `passages/MT.20.1-16/`. */
export function passagePath(key: string): string {
  return `passages/${key}/`;
}

/** The first day of a month as an ISO date; pages format it as the month's name. */
export function monthDate({ year, month }: MonthId): IsoDate {
  return isoDate(year, month, 1);
}

/** Every month of every calendar year in the repository, in order: each committed year gets twelve month pages. */
export function calendarMonths(repo: ContentRepo): MonthId[] {
  return repo.years().flatMap((year) => Array.from({ length: 12 }, (_, index) => ({ year, month: index + 1 })));
}

/**
 * The month `/calendar/` points to: the month of `date` when the repository has its year, otherwise the nearest
 * month that has a page (January of the first year, or December of the last); `null` without any calendar.
 */
export function currentMonth(repo: ContentRepo, date: IsoDate): MonthId | null {
  const years = repo.years();
  const first = years[0];
  const last = years.at(-1);
  if (first === undefined || last === undefined) return null;
  const year = Number(date.slice(0, 4));
  if (years.includes(year)) return { year, month: Number(date.slice(5, 7)) };
  return year < first ? { year: first, month: 1 } : { year: last, month: 12 };
}

/** One year of the archive: its twelve months. */
export interface ArchiveYear {
  readonly year: number;
  readonly months: readonly { readonly id: MonthId; readonly path: string; readonly date: IsoDate }[];
}

/** `/calendar/`: the month to start from and every year with its months. */
export interface CalendarIndexView {
  readonly current: { readonly id: MonthId; readonly path: string; readonly date: IsoDate } | null;
  readonly years: readonly ArchiveYear[];
}

/** The view model of `/calendar/` for a build whose date is `date`. */
export function calendarIndex(repo: ContentRepo, date: IsoDate): CalendarIndexView {
  const current = currentMonth(repo, date);
  return {
    current: current === null ? null : { id: current, path: monthPath(current), date: monthDate(current) },
    years: repo.years().map((year) => ({
      year,
      months: calendarMonths(repo)
        .filter((id) => id.year === year)
        .map((id) => ({ id, path: monthPath(id), date: monthDate(id) })),
    })),
  };
}

/** One day in a month grid. */
export interface CalendarCell {
  readonly date: IsoDate;
  /** Day of the month, 1–31. */
  readonly day: number;
  /** The day page, or `null` when the calendar has no such date (nothing to link to). */
  readonly path: string | null;
  /** The principal celebration's colour, or `null` for a date the calendar lacks. */
  readonly colour: LiturgicalColour | null;
  /** The principal celebration's name, or `null`. */
  readonly celebration: string | null;
  /** `true` when the principal celebration's rank is in `LISTED_RANKS` (the grid shows its name on wide screens). */
  readonly listed: boolean;
  /** `true` on the build date. */
  readonly today: boolean;
}

/** A celebration listed under the grid. */
export interface MonthCelebration {
  readonly date: IsoDate;
  readonly path: string;
  readonly name: string;
  readonly rank: string;
  readonly colour: LiturgicalColour;
}

/** `/calendar/<yyyy>/<mm>/`. */
export interface MonthView {
  readonly id: MonthId;
  /** First of the month, for the heading. */
  readonly date: IsoDate;
  /** Seven dates, one per column in display order, for the weekday headers. */
  readonly weekdays: readonly IsoDate[];
  /** Rows of seven; `null` pads the first and last week. */
  readonly weeks: readonly (readonly (CalendarCell | null)[])[];
  /** Days the calendar has in this month. */
  readonly dayCount: number;
  readonly celebrations: readonly MonthCelebration[];
  readonly prev: { readonly id: MonthId; readonly path: string; readonly date: IsoDate } | null;
  readonly next: { readonly id: MonthId; readonly path: string; readonly date: IsoDate } | null;
}

export interface MonthViewOptions {
  /** The build date, marked as today when it falls in the month. */
  readonly today?: IsoDate;
  /** First column: `0` Sunday … `6` Saturday (default Monday). */
  readonly weekStart?: number;
}

function cellFor(date: IsoDate, day: ResolvedDay | undefined, today: IsoDate | undefined): CalendarCell {
  const principal: Celebration | undefined = day?.day.celebrations[0];
  return {
    date,
    day: Number(date.slice(8, 10)),
    path: day === undefined ? null : dayPath(date),
    colour: day === undefined ? null : dayColour(day.day),
    celebration: principal?.name ?? null,
    listed: principal !== undefined && LISTED_RANKS.has(principal.rank),
    today: date === today,
  };
}

function monthLink(id: MonthId | undefined) {
  return id === undefined ? null : { id, path: monthPath(id), date: monthDate(id) };
}

/** The view model of one month page. Throws for a month outside 1–12. */
export function monthView(repo: ContentRepo, id: MonthId, options: MonthViewOptions = {}): MonthView {
  const { year, month } = id;
  if (!Number.isInteger(month) || month < 1 || month > 12) throw new RangeError(`month must be 1–12, got ${month}`);
  const weekStart = options.weekStart ?? DEFAULT_WEEK_START;
  const length = daysInMonth(year, month);
  const first = isoDate(year, month, 1);
  const days = new Map(repo.listDays(first, isoDate(year, month, length)).map((day) => [day.date, day]));

  const lead = (weekday(first) - weekStart + 7) % 7;
  const cells: (CalendarCell | null)[] = Array.from({ length: lead }, () => null);
  for (let day = 1; day <= length; day += 1) {
    const date = isoDate(year, month, day);
    cells.push(cellFor(date, days.get(date), options.today));
  }
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (CalendarCell | null)[][] = [];
  for (let index = 0; index < cells.length; index += 7) weeks.push(cells.slice(index, index + 7));

  const celebrations = [...days.values()].flatMap((day) =>
    day.day.celebrations
      .filter((celebration: Celebration) => LISTED_RANKS.has(celebration.rank))
      .map((celebration: Celebration) => ({
        date: day.date,
        path: dayPath(day.date),
        name: celebration.name,
        rank: celebration.rank,
        colour: celebration.colour,
      })),
  );

  const months = calendarMonths(repo);
  const at = months.findIndex((m) => m.year === year && m.month === month);
  return {
    id,
    date: first,
    weekdays: Array.from({ length: 7 }, (_, index) => addDays(first, index - lead)),
    weeks,
    dayCount: days.size,
    celebrations,
    prev: at > 0 ? monthLink(months[at - 1]) : null,
    next: at >= 0 ? monthLink(months[at + 1]) : null,
  };
}

/** Static paths for `calendar/[yyyy]/[mm]/index.astro`: one per month of every calendar year. */
export function monthStaticPaths(
  repo: ContentRepo,
): { params: { yyyy: string; mm: string }; props: { id: MonthId } }[] {
  return calendarMonths(repo).map((id) => ({ params: { yyyy: String(id.year), mm: pad(id.month) }, props: { id } }));
}

/**
 * CSS for the colour dots (`.colour-dot[data-colour="…"]`) in light and dark, following the same scheme rules as
 * `themeCss()`. A dot is drawn in the colour's accent, except white, which is drawn white (with the dot's border)
 * so it is not mistaken for gold. Pages always print the colour's name next to a dot: colour is never alone.
 */
export function colourDotCss(): string {
  const rules = (scheme: Scheme, scope: string) =>
    Object.entries(ACCENTS[scheme])
      .map(([colour, accent]) => {
        const fill = colour === 'white' ? (scheme === 'light' ? '#ffffff' : '#f7f2e8') : accent.accent;
        return `${scope} .colour-dot[data-colour="${colour}"]{background:${fill};}`;
      })
      .join('\n');
  const [light, dark] = SCHEMES;
  return [
    rules(light, ':root'),
    `@media (prefers-color-scheme: dark){\n${rules(dark, ':root:not([data-theme="light"])')}\n}`,
    rules(dark, ':root[data-theme="dark"]'),
  ].join('\n');
}

function displayRef(passage: Passage): string {
  const parsed = tryParseRef(passage.ref);
  return parsed.ok ? formatRef(parsed.value, { style: 'long' }) : passage.ref;
}

/** A sort key that orders passages of one book by chapter and verse: `020.001_020.017`. */
function verseOrder(ref: Ref): string {
  const pad3 = (value: number) => String(value).padStart(3, '0');
  return ref.segments.map(({ start }) => `${pad3(start.c)}.${pad3(start.v ?? 0)}`).join('_');
}

/** Notes a passage carries: its context note and each translation note. */
export function noteCount(passage: Passage): number {
  return 1 + passage.translationNotes.length;
}

/** One passage in the library. */
export interface LibraryPassage {
  readonly key: string;
  /** Long reference, `Matthew 20:1–16a`. */
  readonly ref: string;
  readonly path: string;
  readonly contextTitle: string;
  readonly noteCount: number;
  readonly dateCount: number;
}

/** One book in the library. */
export interface LibraryBook {
  readonly code: string;
  readonly name: string;
  readonly testament: 'OT' | 'NT';
  readonly passages: readonly LibraryPassage[];
  /** Notes across the book's passages. */
  readonly noteCount: number;
}

/** `/passages/`: books in canonical order, each with its approved passages in chapter and verse order. */
export interface LibraryView {
  readonly books: readonly LibraryBook[];
  readonly passageCount: number;
  readonly noteCount: number;
}

/** Every approved passage, sorted by key. */
function approved(repo: ContentRepo): Passage[] {
  return repo
    .passageKeys()
    .map((key) => repo.passage(key))
    .filter(isApproved);
}

/** The view model of `/passages/`. */
export function passageLibrary(repo: ContentRepo): LibraryView {
  const byBook = new Map<
    string,
    { order: number; book: Omit<LibraryBook, 'passages' | 'noteCount'>; items: [string, LibraryPassage][] }
  >();
  for (const passage of approved(repo)) {
    const ref = fromKey(passage.key);
    const book = getBook(ref.book);
    let entry = byBook.get(book.code);
    if (entry === undefined) {
      entry = { order: book.order, book: { code: book.code, name: book.name, testament: book.testament }, items: [] };
      byBook.set(book.code, entry);
    }
    entry.items.push([
      verseOrder(ref),
      {
        key: passage.key,
        ref: displayRef(passage),
        path: passagePath(passage.key),
        contextTitle: passage.context.title,
        noteCount: noteCount(passage),
        dateCount: repo.datesForPassage(passage.key).length,
      },
    ]);
  }
  const books = [...byBook.values()]
    .sort((a, b) => a.order - b.order)
    .map(({ book, items }) => {
      const passages = items.sort(([a], [b]) => a.localeCompare(b)).map(([, item]) => item);
      return { ...book, passages, noteCount: passages.reduce((sum, item) => sum + item.noteCount, 0) };
    });
  return {
    books,
    passageCount: books.reduce((sum, book) => sum + book.passages.length, 0),
    noteCount: books.reduce((sum, book) => sum + book.noteCount, 0),
  };
}

/** A translation note's title: where it is and the English word it is about (never its body). */
export interface NoteTitle {
  readonly id: string;
  readonly verse: string;
  readonly anchor: string;
  /** The original-language word or phrase, with its BCP 47 tag. */
  readonly original: { readonly text: string; readonly lang: string; readonly translit: string };
}

/** A date the passage is read on. */
export interface PassageAppearance {
  readonly date: IsoDate;
  /** The Reading page for the passage on that date (its first slot that day). */
  readonly path: string;
  readonly dayPath: string;
  readonly celebration: string | null;
  readonly colour: LiturgicalColour;
  readonly today: boolean;
}

/** `/passages/<key>/`. */
export interface PassageView {
  readonly key: string;
  readonly ref: string;
  readonly summary: string;
  readonly contextTitle: string;
  readonly notes: readonly NoteTitle[];
  readonly noteCount: number;
  readonly lastReviewedAt: string | null;
  readonly appearances: readonly PassageAppearance[];
}

function slotOf(day: ResolvedDay, key: string): string | undefined {
  for (const mass of day.masses) {
    for (const reading of mass.readings) {
      // Read through `Reading`: see `calendarReading` in api.ts.
      const { slot, key: readingKey }: Reading = reading;
      if (readingKey === key) return slot;
    }
  }
  return undefined;
}

/** The view model of one passage page, or `null` when `key` has no approved notes. */
export function passageView(repo: ContentRepo, key: string, today?: IsoDate): PassageView | null {
  const passage = repo.passage(key);
  if (!isApproved(passage)) return null;
  const appearances = repo.datesForPassage(key).flatMap((date): PassageAppearance[] => {
    const day = repo.resolveDay(date);
    const slot = day === null ? undefined : slotOf(day, key);
    if (day === null || slot === undefined) return [];
    return [
      {
        date,
        path: readingPath(date, slot),
        dayPath: dayPath(date),
        celebration: day.day.celebrations[0]?.name ?? null,
        colour: dayColour(day.day),
        today: date === today,
      },
    ];
  });
  return {
    key,
    ref: displayRef(passage),
    summary: passage.summary,
    contextTitle: passage.context.title,
    notes: passage.translationNotes.map(({ id, verse, anchor, original }: TranslationNote) => ({
      id,
      verse,
      anchor,
      original: { text: original.text, lang: original.lang, translit: original.translit },
    })),
    noteCount: noteCount(passage),
    lastReviewedAt: passage.review.lastReviewedAt ?? null,
    appearances,
  };
}

/** Static paths for `passages/[key]/index.astro`: one per approved passage. */
export function passageStaticPaths(repo: ContentRepo): { params: { key: string } }[] {
  return approved(repo).map(({ key }) => ({ params: { key } }));
}
