/**
 * View models for the Today page (`/`) and the day pages (`/[date]/`): the liturgical day, its celebrations and
 * rank, season and week, the Masses with their readings by reference, link-outs, prev/next days, the noscript list
 * of upcoming days and the inline script that moves `/` to the device's own date.
 *
 * Everything here is pure: the strings come from an injected `DayMessages` (the page passes `t` and `formatDate`
 * from src/i18n), site paths from an injected `DayPaths`, and content from a `ContentRepo`. The components in
 * src/components/day only render what these builders return, so `astro check`, which cannot resolve the deep schema
 * types, never sees them: every interface below is spelled out.
 *
 * A reading links to its Reading page (`/[date]/[slot]/`, L-054) only when it has approved notes; otherwise it says
 * the notes are in preparation. Every reading keeps its reference and its link-out either way.
 */
import type { LectioConfig } from '@lectio/config';
import { approvedOnly, isApproved } from '@lectio/content';
import type { ContentRepo, ResolvedDay, ResolvedReading } from '@lectio/content';
import { formatRef, tryParseRef } from '@lectio/refs';
import type { CalendarDay, Celebration, Reading } from '@lectio/schema/calendar';
import { addDays } from '@lectio/shared';
import type { IsoDate } from '@lectio/shared';

import { celebrationName } from './calendar-names.ts';
import type { LocalisedName } from './calendar-names.ts';
import type { MessageParams } from './i18n.ts';
import { partLang } from './locales.ts';
import { linkoutSource, principalFirst, readingPath } from './reading.ts';
import { dayColour } from './theme.ts';

/** The translation functions a page hands to the builders (`t` and `formatDate` from src/i18n/index.ts). */
export interface DayMessages {
  readonly t: (locale: string, key: string, params?: MessageParams) => string;
  readonly formatDate: (locale: string, date: string) => string;
}

/** Turns a site path relative to the locale root (`2026-09-20/`) into an href with the base path and locale. */
export type DayPaths = (path: string) => string;

/** What every builder needs besides the content. */
export interface DayEnv {
  readonly lang: string;
  readonly messages: DayMessages;
  readonly paths: DayPaths;
}

/** The parts of the config the day pages read. */
export type DayConfig = Pick<LectioConfig, 'site' | 'linkout'>;

/** Days before the build date that `/` still knows about (a device behind Nairobi may be on the previous day). */
export const TODAY_DAYS_BEFORE = 2;
/** Days from the build date on that `/` knows about: the build date and the 13 days after it. */
export const TODAY_DAYS_AHEAD = 14;
/** Days in the noscript list of upcoming days on `/`. */
export const UPCOMING_LIST_DAYS = 7;

export interface LinkoutView {
  readonly href: string;
  /** The visible text, `Text`; the page adds the `↗` mark. */
  readonly text: string;
  /** Read by screen readers after `text`: the reference, the source and the new-tab notice. */
  readonly detail: string;
}

export interface ReadingView {
  readonly slot: string;
  /** `Gospel`, `First reading`, `Reading 3`… */
  readonly slotLabel: string;
  /** The reference in full (`Matthew 20:1–16a`); the calendar's own text if it does not parse. */
  readonly refLabel: string;
  /** The Reading page, when the reading has approved notes and a page of its own; otherwise `null`. */
  readonly href: string | null;
  /** The approved notes' one-line summary, or `null`. */
  readonly summary: string | null;
  /** The summary's language when it differs from the page locale (English notes on a Kiswahili page). */
  readonly summaryLang?: string | undefined;
  /** `Notes in preparation` when there are no approved notes; otherwise `null`. */
  readonly pending: string | null;
  readonly linkout: LinkoutView;
}

export interface MassView {
  readonly id: string;
  readonly label: string;
  readonly readings: readonly ReadingView[];
}

export interface CelebrationView {
  readonly name: string;
  /** The language of `name` when it differs from the page locale (untranslated English), for `lang`. */
  readonly nameLang?: string | undefined;
  readonly rank: string;
  readonly colour: string;
  readonly colourLabel: string;
}

export interface AdjacentDayView {
  readonly date: IsoDate;
  readonly href: string;
  /** `Previous day` / `Next day`. */
  readonly label: string;
  readonly dateLabel: string;
}

export interface ListenView {
  readonly href: string;
  readonly label: string;
}

export interface DayView {
  readonly date: IsoDate;
  readonly lang: string;
  /** `Sunday 20 September 2026`. */
  readonly dateLabel: string;
  /** The principal celebration's colour, for `<html data-colour>`. */
  readonly colour: string;
  /** The principal celebration's name: the page heading. */
  readonly title: string;
  /** The language of `title` when it differs from the page locale (untranslated English), for `lang`. */
  readonly titleLang?: string | undefined;
  readonly celebrations: readonly CelebrationView[];
  /** `Ordinary Time · Week 25`. */
  readonly season: string;
  /** `Sunday cycle A · Weekday cycle II`. */
  readonly cycles: string;
  readonly masses: readonly MassView[];
  /** `This day has 2 Masses to choose from.` when there is more than one Mass; otherwise `null`. */
  readonly massOptions: string | null;
  /** Shown instead of the readings when the calendar has no lectionary data for the day; otherwise `null`. */
  readonly missing: string | null;
  /**
   * Shown instead of the readings on a day without any Mass (`noMass`); otherwise `null`. Holy Saturday is the only
   * such day (`NO_MASS_DAYS` in `@lectio/lectionary`), so the copy is Holy Saturday's: a second day needs its own.
   */
  readonly noMass: string | null;
  /** The Listen button, when `config.site.features.listen` is on; otherwise `null`. */
  readonly listen: ListenView | null;
  readonly previous: AdjacentDayView | null;
  readonly next: AdjacentDayView | null;
  /** The document title (the layout appends ` · Lectio`). */
  readonly pageTitle: string;
  readonly description: string;
}

/** One line of the noscript list of upcoming days. */
export interface UpcomingDayView {
  readonly date: IsoDate;
  readonly href: string;
  readonly dateLabel: string;
  readonly title: string;
  /** The language of `title` when it differs from the page locale (untranslated English), for `lang`. */
  readonly titleLang?: string | undefined;
}

/** The site path of a day page, relative to the locale root. */
export function dayPath(date: IsoDate): string {
  return `${date}/`;
}

/** The site path of the Listen page (L-085), relative to the locale root. */
export function listenPath(date: IsoDate): string {
  return `${date}/listen/`;
}

/** The season name, e.g. `Ordinary Time`. */
export function seasonName(env: DayEnv, season: string): string {
  const { t } = env.messages;
  const { lang } = env;
  switch (season) {
    case 'advent':
      return t(lang, 'day.season.advent');
    case 'christmas':
      return t(lang, 'day.season.christmas');
    case 'lent':
      return t(lang, 'day.season.lent');
    case 'paschal-triduum':
      return t(lang, 'day.season.paschalTriduum');
    case 'easter':
      return t(lang, 'day.season.easter');
    default:
      return t(lang, 'day.season.ordinaryTime');
  }
}

/** The season with its week, `Ordinary Time · Week 25`; week 0 (the days before a season's first Sunday) is left out. */
export function seasonLabel(env: DayEnv, season: string, week: number): string {
  const { t } = env.messages;
  const name = seasonName(env, season);
  return week > 0 ? t(env.lang, 'day.seasonWeek', { season: name, week }) : name;
}

/** The rank of a celebration, e.g. `Sunday`, `Optional memorial`. */
export function rankLabel(env: DayEnv, rank: string): string {
  const { t } = env.messages;
  const { lang } = env;
  switch (rank) {
    case 'solemnity':
      return t(lang, 'day.rank.solemnity');
    case 'sunday':
      return t(lang, 'day.rank.sunday');
    case 'feast':
      return t(lang, 'day.rank.feast');
    case 'memorial':
      return t(lang, 'day.rank.memorial');
    case 'optional-memorial':
      return t(lang, 'day.rank.optionalMemorial');
    case 'commemoration':
      return t(lang, 'day.rank.commemoration');
    default:
      return t(lang, 'day.rank.weekday');
  }
}

/** The name of a liturgical colour, e.g. `Green`. */
export function colourLabel(env: DayEnv, colour: string): string {
  const { t } = env.messages;
  const { lang } = env;
  switch (colour) {
    case 'white':
      return t(lang, 'day.colour.white');
    case 'red':
      return t(lang, 'day.colour.red');
    case 'violet':
      return t(lang, 'day.colour.violet');
    case 'rose':
      return t(lang, 'day.colour.rose');
    case 'black':
      return t(lang, 'day.colour.black');
    case 'gold':
      return t(lang, 'day.colour.gold');
    default:
      return t(lang, 'day.colour.green');
  }
}

const NUMBERED_SLOT = /^(reading|psalm)-(\d)$/;

/** The label of a reading slot: `First reading`, `Psalm`, `Gospel`, `Reading 3`, `Psalm 2`, `Epistle`; else `Reading`. */
export function slotLabel(env: DayEnv, slot: string): string {
  const { t } = env.messages;
  const { lang } = env;
  const numbered = NUMBERED_SLOT.exec(slot);
  if (numbered !== null) {
    const n = Number(numbered[2]);
    return numbered[1] === 'psalm' ? t(lang, 'day.slot.psalmN', { n }) : t(lang, 'day.slot.readingN', { n });
  }
  switch (slot) {
    case 'first-reading':
      return t(lang, 'day.slot.firstReading');
    case 'psalm':
      return t(lang, 'day.slot.psalm');
    case 'second-reading':
      return t(lang, 'day.slot.secondReading');
    case 'epistle':
      return t(lang, 'day.slot.epistle');
    case 'gospel':
      return t(lang, 'day.slot.gospel');
    default:
      return t(lang, 'day.slot.other');
  }
}

/** A calendar reference written in full (`Mt 20:1-16a` → `Matthew 20:1–16a`), or as given if it does not parse. */
export function refLabel(ref: string): string {
  const parsed = tryParseRef(ref);
  return parsed.ok ? formatRef(parsed.value, { style: 'long' }) : ref;
}

/** The parts of a Mass `slotOwners` reads (spelled out: `astro check` cannot resolve the schema types). */
export interface SlotMass {
  readonly id: string;
  readonly readings: readonly { readonly slot: string }[];
}

/**
 * Which Mass owns each slot's Reading page. The route is `/[date]/[slot]/`, so each slot gets one page: from the
 * principal Mass (`principalFirst`) when it uses the slot, otherwise from the first Mass in calendar order that does.
 * Any other Mass reusing the slot has no Reading-page link for it.
 */
export function slotOwners(masses: readonly SlotMass[]): Map<string, string> {
  const owners = new Map<string, string>();
  for (const mass of principalFirst(masses)) {
    for (const { slot } of mass.readings) if (!owners.has(slot)) owners.set(slot, mass.id);
  }
  return owners;
}

function readingView(
  env: DayEnv,
  date: IsoDate,
  config: Pick<LectioConfig, 'linkout'>,
  reading: ResolvedReading,
  ownsPage: boolean,
): ReadingView {
  const { t } = env.messages;
  const { lang } = env;
  // Read the calendar fields through `Reading` (see `readingSummaries` in site.ts).
  const { slot, ref, linkout }: Reading = reading;
  const label = refLabel(ref);
  const approved = isApproved(reading.passage);
  const source = linkoutSource(config, linkout);
  return {
    slot,
    slotLabel: slotLabel(env, slot),
    refLabel: label,
    href: approved && ownsPage ? env.paths(readingPath(date, slot)) : null,
    summary: approved ? reading.passage.summary : null,
    summaryLang: approved ? partLang(reading.passage.locale, env.lang) : undefined,
    pending: approved ? null : t(lang, 'day.notesInPreparation'),
    linkout: {
      href: linkout,
      text: t(lang, 'day.linkout.text'),
      detail: t(lang, 'day.linkout.detail', { ref: label, source }),
    },
  };
}

function adjacent(env: DayEnv, date: IsoDate | null, label: string): AdjacentDayView | null {
  if (date === null) return null;
  return { date, href: env.paths(dayPath(date)), label, dateLabel: env.messages.formatDate(env.lang, date) };
}

/** The calendar days just before and after `date`, when the repository has them. */
export function adjacentDates(
  repo: Pick<ContentRepo, 'resolveDay'>,
  date: IsoDate,
): { readonly previous: IsoDate | null; readonly next: IsoDate | null } {
  const before = addDays(date, -1);
  const after = addDays(date, 1);
  return {
    previous: repo.resolveDay(before) === null ? null : before,
    next: repo.resolveDay(after) === null ? null : after,
  };
}

export interface DayViewOptions {
  readonly config: DayConfig;
  readonly previous?: IsoDate | null;
  readonly next?: IsoDate | null;
}

/** A localised celebration name as view fields: `name` and, for an untranslated name, `nameLang`. */
function named({ name, lang }: LocalisedName): { name: string; nameLang?: string | undefined } {
  return lang === undefined ? { name } : { name, nameLang: lang };
}

/** The same as `title` and `titleLang`. */
function titled({ name, lang }: LocalisedName): { title: string; titleLang?: string | undefined } {
  return lang === undefined ? { title: name } : { title: name, titleLang: lang };
}

/**
 * The view model of a day page. The day goes through `approvedOnly` first, so an unapproved passage can never reach
 * the page even if a caller passes the raw repository day.
 */
export function dayView(env: DayEnv, resolved: ResolvedDay, options: DayViewOptions): DayView {
  const day = approvedOnly(resolved);
  const { t, formatDate } = env.messages;
  const { lang } = env;
  const { date } = day;
  const { season, seasonWeek, sundayCycle, weekdayCycle, celebrations, lectionaryMissing, noMass }: CalendarDay =
    day.day;
  const owners = slotOwners(
    day.masses.map((mass) => ({
      id: mass.id,
      readings: (mass.readings as readonly Reading[]).map(({ slot }) => ({ slot })),
    })),
  );
  const masses: MassView[] = day.masses.map((mass) => ({
    id: mass.id,
    label: mass.label,
    readings: mass.readings.map((reading) =>
      readingView(env, date, options.config, reading, owners.get((reading as Reading).slot) === mass.id),
    ),
  }));
  const celebrationViews = celebrations.map((celebration: Celebration) => ({
    ...named(celebrationName(celebration, lang)),
    rank: rankLabel(env, celebration.rank),
    colour: celebration.colour,
    colourLabel: colourLabel(env, celebration.colour),
  }));
  const title = celebrationViews[0]?.name ?? formatDate(lang, date);
  const titleLang = celebrationViews[0]?.nameLang;
  const dateLabel = formatDate(lang, date);
  const refs = masses[0]?.readings.map((reading) => reading.refLabel) ?? [];
  const withoutMass = noMass === true;
  const missing = !withoutMass && (lectionaryMissing || masses.length === 0) ? t(lang, 'day.lectionaryMissing') : null;
  const seasonText = seasonLabel(env, season, seasonWeek);
  // The meta description says what the day's share card says (its alt text, L-088): date, celebration, season and
  // readings; `·` becomes a comma, as some screen readers read it out as "middle dot".
  const described = { date: dateLabel, title, season: seasonText.replaceAll(' · ', ', ') };
  return {
    date,
    lang,
    dateLabel,
    colour: dayColour(day.day),
    title,
    titleLang,
    celebrations: celebrationViews,
    season: seasonText,
    cycles: t(lang, 'day.cycles', { sunday: sundayCycle, weekday: weekdayCycle }),
    masses,
    massOptions: masses.length > 1 ? t(lang, 'day.massOptions', { count: masses.length }) : null,
    missing,
    noMass: withoutMass ? t(lang, 'day.holySaturdayNoMass') : null,
    listen: options.config.site.features.listen
      ? { href: env.paths(listenPath(date)), label: t(lang, 'day.listen') }
      : null,
    previous: adjacent(env, options.previous ?? null, t(lang, 'day.previousDay')),
    next: adjacent(env, options.next ?? null, t(lang, 'day.nextDay')),
    pageTitle: t(lang, 'day.pageTitle', { title, date: dateLabel }),
    description: withoutMass
      ? t(lang, 'day.descriptionHolySaturday', described)
      : refs.length === 0
        ? t(lang, 'day.descriptionNoReadings', described)
        : t(lang, 'day.description', { ...described, refs: refs.join('; ') }),
  };
}

/** The view model of the day page for `date`, or `null` when no committed calendar has that date. */
export function dayPageView(
  env: DayEnv,
  context: { readonly config: DayConfig; readonly repo: ContentRepo },
  date: IsoDate,
): DayView | null {
  const day = context.repo.resolveDay(date);
  if (day === null) return null;
  return dayView(env, day, { config: context.config, ...adjacentDates(context.repo, date) });
}

/** Every date in the committed calendars, in order. */
export function calendarDates(repo: Pick<ContentRepo, 'years' | 'calendarYear'>): IsoDate[] {
  return repo
    .years()
    .flatMap((year) => repo.calendarYear(year)?.days.map((day: CalendarDay) => day.date as IsoDate) ?? [])
    .sort();
}

/** Static paths for `pages/[date]/index.astro`: one per day in the committed calendars. */
export function dayPagePaths(
  repo: Pick<ContentRepo, 'years' | 'calendarYear'>,
): { readonly params: { readonly date: IsoDate } }[] {
  return calendarDates(repo).map((date) => ({ params: { date } }));
}

/** The calendar dates `/` knows about around `date`: `TODAY_DAYS_BEFORE` before it to `TODAY_DAYS_AHEAD - 1` after. */
export function todayWindowDates(repo: Pick<ContentRepo, 'listDays'>, date: IsoDate): IsoDate[] {
  return repo.listDays(addDays(date, -TODAY_DAYS_BEFORE), addDays(date, TODAY_DAYS_AHEAD - 1)).map((day) => day.date);
}

/** The noscript list on `/`: `date` and the days after it, `UPCOMING_LIST_DAYS` in all, as far as the calendars go. */
export function upcomingDays(env: DayEnv, repo: Pick<ContentRepo, 'listDays'>, date: IsoDate): UpcomingDayView[] {
  return repo.listDays(date, addDays(date, UPCOMING_LIST_DAYS - 1)).map((day) => {
    const dateLabel = env.messages.formatDate(env.lang, day.date);
    const { celebrations }: CalendarDay = day.day;
    return {
      date: day.date,
      href: env.paths(dayPath(day.date)),
      dateLabel,
      ...(celebrations[0] === undefined ? { title: dateLabel } : titled(celebrationName(celebrations[0], env.lang))),
    };
  });
}

/** What the inline script on `/` needs: the date the page was built for and the day pages it may switch to. */
export interface TodaySwitch {
  readonly buildDate: IsoDate;
  /** Day page hrefs by date, for the dates around the build date (`todayWindowDates`). */
  readonly pages: Readonly<Record<string, string>>;
  /**
   * The saved-language switch (L-110), on the default locale's Today page only: the settings storage key and, for
   * every other site locale, its Today page and day pages. A reader who saved one of those languages (which only the
   * switcher or the settings page can store) goes there first, to the day page for the device date.
   */
  readonly language?: {
    readonly key: string;
    readonly others: Readonly<
      Record<string, { readonly home: string; readonly pages: Readonly<Record<string, string>> }>
    >;
  };
}

/**
 * The site locales for `todaySwitch`: the storage key, the locales, the default locale and a base-aware path in each.
 */
export interface TodaySwitchLanguages {
  readonly key: string;
  readonly locales: readonly string[];
  readonly defaultLocale: string;
  readonly paths: (locale: string, path: string) => string;
}

/** The data for the inline script on `/`. */
export function todaySwitch(
  env: DayEnv,
  repo: Pick<ContentRepo, 'listDays'>,
  buildDate: IsoDate,
  languages?: TodaySwitchLanguages,
): TodaySwitch {
  const dates = todayWindowDates(repo, buildDate);
  const pagesFor = (href: (path: string) => string) =>
    Object.fromEntries(dates.map((date) => [date, href(dayPath(date))]));
  const pages = pagesFor(env.paths);
  // Only the default locale's Today page switches language. A saved default language is not a choice (settings save
  // every field, so it is stored as soon as any setting changes), and an explicit /sw/ link is always respected.
  if (languages === undefined || env.lang !== languages.defaultLocale) return { buildDate, pages };
  const others = Object.fromEntries(
    languages.locales
      .filter((locale) => locale !== env.lang)
      .map((locale) => [
        locale,
        { home: languages.paths(locale, ''), pages: pagesFor((path) => languages.paths(locale, path)) },
      ]),
  );
  return { buildDate, pages, language: { key: languages.key, others } };
}

/**
 * The inline script on `/`. The page is rendered for the build date in the site time zone (Nairobi). A reader who
 * saved another site language (L-110) goes to that language's day page for the device date, or its Today page; else,
 * if the device's own date is different and the site has a page for it, the script replaces `/` with that day page.
 * With no page for the device date it stays on the build date. `<` is escaped so the data cannot close the script
 * element; a storage error is ignored.
 */
export function todaySwitchScript(data: TodaySwitch): string {
  const json = JSON.stringify(data).replaceAll('<', '\\u003c');
  return (
    `(function(d){var n=new Date(),p=function(x){return(x<10?'0':'')+x},` +
    `t=n.getFullYear()+'-'+p(n.getMonth()+1)+'-'+p(n.getDate()),h=d.pages[t],l=d.language;` +
    `if(l){try{var s=JSON.parse(localStorage.getItem(l.key)||'null'),c=s&&s.language;` +
    `if(typeof c==='string'&&Object.prototype.hasOwnProperty.call(l.others,c)){var o=l.others[c];` +
    `location.replace(t!==d.buildDate&&o.pages[t]||o.home);return}}catch(e){}}` +
    `if(t!==d.buildDate&&h)location.replace(h)})(${json});`
  );
}
