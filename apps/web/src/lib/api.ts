/**
 * The static JSON API v1 (`/api/v1/…`, [docs/api.md](../../../../docs/api.md)): pure functions that turn the
 * content repository into the documents `src/pages/api/v1/**` writes at build time. The Flutter apps and the
 * service worker read these files; there is no server.
 *
 * Only approved notes are exposed: every passage goes through `approvedOnly`/`isApproved` from `@lectio/content`,
 * and the provenance block (models, run ids, cost) never leaves the repository. Every `audio` field is `null`
 * until the narration pipeline (L-082) fills it. The shapes are `@lectio/schema/api`; the tests validate every
 * document built from the fixture content root against it.
 */
import type { LectioConfig } from '@lectio/config';
import { approvedOnly, isApproved } from '@lectio/content';
import type { ContentRepo, ResolvedDay, ResolvedReading } from '@lectio/content';
import { API_ENDPOINTS, API_VERSION, UPCOMING_DAYS } from '@lectio/schema/api';
import type {
  ApiCalendar,
  ApiDay,
  ApiDaySummary,
  ApiIndex,
  ApiNotes,
  ApiPassage,
  ApiPassageIndex,
  ApiUpcoming,
} from '@lectio/schema/api';
import type { CalendarDay, Celebration, Reading } from '@lectio/schema/calendar';
import type { Passage, PassageClaim, PassageSource, TranslationNote } from '@lectio/schema/passage';
import { addDays } from '@lectio/shared';
import type { IsoDate } from '@lectio/shared';

import { siteContext, siteDate } from './site.ts';
import { dayColour } from './theme.ts';

export { API_ENDPOINTS, API_VERSION, UPCOMING_DAYS };

/** What every API document is built from: the site config, the content repository and the build date. */
export interface ApiContext {
  readonly config: Pick<LectioConfig, 'site'>;
  readonly repo: ContentRepo;
  /** The date the build treats as today (`siteDate`: `$LECTIO_DATE`, else today in `config.site.timezone`). */
  readonly date: IsoDate;
}

/** The build's API context: the shared site context and its date. The endpoints call this. */
export function apiContext(): ApiContext {
  const { config, repo } = siteContext();
  return { config, repo, date: siteDate(config) };
}

/** Absolute URL of the API root, `<config.site.baseUrl>api/v1/`; endpoint templates resolve against it. */
export function apiRootUrl(config: Pick<LectioConfig, 'site'>): string {
  const base = config.site.baseUrl.endsWith('/') ? config.site.baseUrl : `${config.site.baseUrl}/`;
  return new URL(`api/v${String(API_VERSION)}/`, base).href;
}

/** The path of a document relative to the API root: `apiPath('day', { date: '2026-09-20' })` → `days/2026-09-20.json`. */
export function apiPath(endpoint: keyof typeof API_ENDPOINTS, values: Readonly<Record<string, string>> = {}): string {
  return API_ENDPOINTS[endpoint].replace(/\{(\w+)\}/g, (placeholder, name: string) => {
    const value = values[name];
    if (value === undefined) throw new RangeError(`${endpoint} needs a value for ${placeholder}`);
    return value;
  });
}

/**
 * The reader-facing notes for an approved passage: the passage without provenance, with `audio: null` on the
 * context and each translation note and a review block that says how and when it was approved. `null` for a
 * missing or unapproved passage.
 */
export function apiNotes(passage: Passage | null | undefined): ApiNotes | null {
  if (!isApproved(passage)) return null;
  const { key, ref, locale, summary, context, translationNotes, claims, sources, review } = passage;
  if (review.method === undefined) throw new Error(`Approved passage ${key} has no review method`);
  return {
    key,
    ref,
    locale,
    summary,
    context: { title: context.title, paragraphs: [...context.paragraphs], audio: null },
    translationNotes: translationNotes.map((note: TranslationNote) => ({ ...note, audio: null })),
    claims: claims.map((claim: PassageClaim) => ({ ...claim, sourceIds: [...claim.sourceIds] })),
    sources: sources.map((source: PassageSource) => ({ ...source })),
    review: { status: 'approved', method: review.method, lastReviewedAt: review.lastReviewedAt ?? null },
  };
}

/**
 * The calendar fields of a reading, and nothing else. Read through `Reading` itself: `astro check` sees the schema
 * types as `any` and so loses the members `ResolvedReading` inherits from it (see `readingSummaries` in site.ts).
 */
function calendarReading(reading: ResolvedReading): Reading {
  const { slot, ref, key, linkout }: Reading = reading;
  return { slot, ref, key, linkout };
}

function dayHeader(day: ResolvedDay) {
  const { date, season, seasonWeek, sundayCycle, weekdayCycle, celebrations, lectionaryMissing } = day.day;
  return {
    date,
    season,
    seasonWeek,
    sundayCycle,
    weekdayCycle,
    colour: dayColour(day.day),
    celebrations: celebrations.map((celebration: Celebration) => ({ ...celebration })),
    lectionaryMissing,
  };
}

/** `/api/v1/days/{date}.json`: the day, its Masses and readings, and each reading's approved notes inline. */
export function apiDay(day: ResolvedDay): ApiDay {
  return {
    apiVersion: API_VERSION,
    ...dayHeader(day),
    masses: approvedOnly(day).masses.map(({ id, label, readings }) => ({
      id,
      label,
      readings: readings.map((reading) => ({ ...calendarReading(reading), passage: apiNotes(reading.passage) })),
    })),
  };
}

/** A day as `calendar/{year}.json` and `upcoming.json` list it: readings with `hasNotes` and the summary. */
export function apiDaySummary(day: ResolvedDay): ApiDaySummary {
  return {
    ...dayHeader(day),
    masses: day.masses.map(({ id, label, readings }) => ({
      id,
      label,
      readings: readings.map((reading) => {
        const { passage } = reading;
        const approved = isApproved(passage);
        return { ...calendarReading(reading), hasNotes: approved, summary: approved ? passage.summary : null };
      }),
    })),
  };
}

function wholeYear(repo: ContentRepo, year: number): ResolvedDay[] {
  return repo.listDays(`${String(year)}-01-01`, `${String(year)}-12-31`);
}

/** Every day document, across every calendar year, in date order. */
export function apiDays(repo: ContentRepo): ApiDay[] {
  return repo.years().flatMap((year) => wholeYear(repo, year).map(apiDay));
}

/** `/api/v1/calendar/{year}.json`, or `null` when the repository has no calendar for `year`. */
export function apiCalendar(repo: ContentRepo, year: number): ApiCalendar | null {
  const calendar = repo.calendarYear(year);
  if (calendar === null) return null;
  return {
    apiVersion: API_VERSION,
    year: calendar.year,
    region: calendar.region,
    days: wholeYear(repo, year).map(apiDaySummary),
  };
}

/** Every passage with approved notes, sorted by key. Pending passages are left out. */
export function approvedPassages(repo: ContentRepo): Passage[] {
  return repo
    .passageKeys()
    .map((key) => repo.passage(key))
    .filter(isApproved);
}

/** `/api/v1/passages/{key}.json`, or `null` when `key` has no approved notes. */
export function apiPassage(repo: ContentRepo, key: string): ApiPassage | null {
  const notes = apiNotes(repo.passage(key));
  if (notes === null) return null;
  return { apiVersion: API_VERSION, passage: notes, dates: repo.datesForPassage(key) };
}

/** `/api/v1/passages/index.json`: every approved passage with its summary and dates. */
export function apiPassageIndex(repo: ContentRepo): ApiPassageIndex {
  return {
    apiVersion: API_VERSION,
    passages: approvedPassages(repo).map(({ key, ref, summary, review }) => ({
      key,
      ref,
      summary,
      lastReviewedAt: review.lastReviewedAt ?? null,
      dates: repo.datesForPassage(key),
    })),
  };
}

/** The window `upcoming.json` covers: `date` and the `UPCOMING_DAYS - 1` days after it. */
export function upcomingWindow(date: IsoDate): { readonly from: IsoDate; readonly to: IsoDate } {
  return { from: date, to: addDays(date, UPCOMING_DAYS - 1) };
}

/** `/api/v1/upcoming.json`: the build date and the 13 days after it (site time zone); missing dates are skipped. */
export function apiUpcoming(context: ApiContext): ApiUpcoming {
  const { from, to } = upcomingWindow(context.date);
  return {
    apiVersion: API_VERSION,
    timezone: context.config.site.timezone,
    from,
    to,
    days: context.repo.listDays(from, to).map(apiDaySummary),
  };
}

/** `/api/v1/index.json`: the build date, what exists, and the endpoint templates. */
export function apiIndex(context: ApiContext): ApiIndex {
  const { config, repo, date } = context;
  const years = repo.years();
  const dates = years.flatMap((year) => repo.calendarYear(year)?.days.map((day: CalendarDay) => day.date) ?? []).sort();
  const first = dates[0];
  const last = dates.at(-1);
  return {
    apiVersion: API_VERSION,
    buildDate: date,
    timezone: config.site.timezone,
    defaultLocale: config.site.defaultLocale,
    locales: [...config.site.locales],
    apiRoot: apiRootUrl(config),
    years,
    dates: first === undefined || last === undefined ? null : { first, last },
    passageCount: approvedPassages(repo).length,
    endpoints: { ...API_ENDPOINTS },
  };
}

/** Every document the API publishes, by path relative to the API root (`days/2026-09-20.json` → document). */
export function apiFiles(context: ApiContext): Map<string, unknown> {
  const { repo } = context;
  const files = new Map<string, unknown>();
  files.set(apiPath('index'), apiIndex(context));
  files.set(apiPath('upcoming'), apiUpcoming(context));
  files.set(apiPath('passages'), apiPassageIndex(repo));
  for (const year of repo.years()) files.set(apiPath('calendar', { year: String(year) }), apiCalendar(repo, year));
  for (const day of apiDays(repo)) files.set(apiPath('day', { date: day.date }), day);
  for (const passage of approvedPassages(repo)) {
    files.set(apiPath('passage', { key: passage.key }), apiPassage(repo, passage.key));
  }
  return files;
}

/** One Astro static path: the route params and the document as a prop. */
export interface ApiStaticPath<P extends string> {
  readonly params: Readonly<Record<P, string>>;
  readonly props: { readonly document: unknown };
}

/** Static paths for `days/[date].json.ts`: one per calendar day. */
export function dayStaticPaths(repo: ContentRepo): ApiStaticPath<'date'>[] {
  return apiDays(repo).map((document) => ({ params: { date: document.date }, props: { document } }));
}

/** Static paths for `passages/[key].json.ts`: one per approved passage. */
export function passageStaticPaths(repo: ContentRepo): ApiStaticPath<'key'>[] {
  return approvedPassages(repo).map(({ key }) => ({ params: { key }, props: { document: apiPassage(repo, key) } }));
}

/** Static paths for `calendar/[year].json.ts`: one per calendar year. */
export function calendarStaticPaths(repo: ContentRepo): ApiStaticPath<'year'>[] {
  return repo.years().map((year) => ({ params: { year: String(year) }, props: { document: apiCalendar(repo, year) } }));
}

/** The body of every API file: compact JSON, served as `application/json`. */
export function jsonResponse(document: unknown): Response {
  return new Response(JSON.stringify(document), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
