/**
 * Build-time site settings derived from the Lectio config: Astro's `site` and `base`, the content repository the
 * pages read, and base-aware URLs. `astro.config.mjs` and the layouts call these; nothing here touches the network.
 *
 * The config file is chosen by `@lectio/config` (`LECTIO_CONFIG`, else `config/lectio.config.json`), so
 * `npm run build:fixture -w apps/web` builds the same site against `apps/web/test/fixtures/content`.
 */
import { isAbsolute, resolve } from 'node:path';

import { findRepoRoot, loadConfig } from '@lectio/config';
import type { LectioConfig, LoadConfigOptions } from '@lectio/config';
import { isApproved, openRepo } from '@lectio/content';
import type { ContentRepo, OpenRepoOptions, ResolvedDay } from '@lectio/content';
import type { Reading } from '@lectio/schema/calendar';
import { isIsoDate, toIsoDateInZone } from '@lectio/shared';
import type { IsoDate } from '@lectio/shared';

/** The Astro options that come from `config.site`. */
export interface AstroSiteOptions {
  /** Absolute site URL (`config.site.baseUrl`). */
  readonly site: string;
  /** Path prefix with a leading and trailing slash (`/` at a domain root). */
  readonly base: string;
}

/** `basePath` as Astro wants it: `''`, `/` and `/x/` become `/` and `/x/`. */
export function normaliseBase(basePath: string): string {
  const trimmed = basePath.replace(/^\/+|\/+$/g, '');
  return trimmed === '' ? '/' : `/${trimmed}/`;
}

/** Astro's `site` and `base` for `config`. */
export function astroSiteOptions(config: Pick<LectioConfig, 'site'>): AstroSiteOptions {
  return { site: config.site.baseUrl, base: normaliseBase(config.site.basePath) };
}

/**
 * The absolute content root: `config.content.root` resolved against the repository root (the nearest directory
 * above `cwd` with npm workspaces), unless it is already absolute.
 */
export function contentRootPath(config: Pick<LectioConfig, 'content'>, cwd: string): string {
  const { root } = config.content;
  return isAbsolute(root) ? root : resolve(findRepoRoot(cwd), root);
}

export interface SiteContext {
  readonly config: LectioConfig;
  readonly contentRoot: string;
  readonly repo: ContentRepo;
}

export interface SiteContextOptions extends LoadConfigOptions {
  readonly fs?: OpenRepoOptions['fs'];
}

let cached: SiteContext | undefined;

/**
 * Loads the config and opens the content repository it names. Pages share one context per build (the repository
 * caches the files it has read), so the first call does the work and later calls return it; pass options to get a
 * fresh, uncached context (tests do).
 */
export function siteContext(options?: SiteContextOptions): SiteContext {
  if (options === undefined && cached !== undefined) return cached;
  const opts = options ?? {};
  const env = opts.env ?? process.env;
  const cwd = resolve(opts.cwd ?? env.INIT_CWD ?? process.cwd());
  const config = loadConfig(undefined, { env, cwd });
  const contentRoot = contentRootPath(config, cwd);
  const context: SiteContext = {
    config,
    contentRoot,
    repo: openRepo(contentRoot, opts.fs === undefined ? {} : { fs: opts.fs }),
  };
  if (options === undefined) cached = context;
  return context;
}

/** Today's date in `timezone` (the config's `site.timezone`), as an ISO date. */
export function todayIn(timezone: string, now: Date = new Date()): IsoDate {
  return toIsoDateInZone(now, timezone);
}

/** Environment variable that pins the date a build treats as "today" (`build:fixture` sets the fixture Sunday). */
export const DATE_ENV_VAR = 'LECTIO_DATE';

/**
 * The date a build treats as "today": `$LECTIO_DATE` when set (so fixture builds and their screenshots are
 * reproducible), otherwise today in `config.site.timezone`. Throws when `LECTIO_DATE` is set but not an ISO date.
 */
export function siteDate(
  config: Pick<LectioConfig, 'site'>,
  env: Readonly<Record<string, string | undefined>> = process.env,
  now: Date = new Date(),
): IsoDate {
  const pinned = env[DATE_ENV_VAR];
  if (pinned === undefined || pinned === '') return todayIn(config.site.timezone, now);
  if (!isIsoDate(pinned))
    throw new RangeError(`${DATE_ENV_VAR} must be an ISO date (YYYY-MM-DD), got ${JSON.stringify(pinned)}`);
  return pinned;
}

/**
 * The day to show for `date`: that day when the calendar has it, otherwise the latest earlier day of the same year
 * that has readings, otherwise the earliest day of that year with readings, otherwise `null`. The scaffold's
 * placeholder home page uses it so a build always shows real content.
 */
export function dayOrNearest(repo: ContentRepo, date: IsoDate): ResolvedDay | null {
  const exact = repo.resolveDay(date);
  if (exact !== null) return exact;
  const year = date.slice(0, 4);
  const withReadings = repo
    .listDays(`${year}-01-01`, `${year}-12-31`)
    .filter((day) => day.masses.some((mass) => mass.readings.length > 0));
  const earlier = withReadings.filter((day) => day.date < date);
  return earlier.at(-1) ?? withReadings[0] ?? null;
}

/** One reading as the scaffold page lists it. */
export interface ReadingSummary {
  readonly slot: string;
  readonly ref: string;
  readonly linkout: string;
  /** The approved passage's one-line summary, or `null`. */
  readonly summary: string | null;
}

/**
 * The readings of `day`'s first Mass with the approved summary of each, for the scaffold page. Explicit
 * interfaces keep `.astro` files away from the deep schema types, which `astro check` cannot resolve.
 */
export function readingSummaries(day: ResolvedDay): ReadingSummary[] {
  return (day.masses[0]?.readings ?? []).map((reading) => {
    // Read the calendar fields through `Reading` itself: `astro check` sees the schema types as `any` and so
    // loses the members `ResolvedReading` inherits from it.
    const { slot, ref, linkout }: Reading = reading;
    return { slot, ref, linkout, summary: isApproved(reading.passage) ? reading.passage.summary : null };
  });
}

/**
 * A site-internal URL under `base`: `withBase('/lectio/', 'calendar/')` is `/lectio/calendar/`. Leading slashes on
 * `path` are ignored so callers cannot escape the base by accident.
 */
export function withBase(base: string, path = ''): string {
  return `${normaliseBase(base)}${path.replace(/^\/+/, '')}`;
}
