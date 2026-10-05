/**
 * Proper-of-time keys: `<season>-sunday-<week>` and `<season>-weekday-<week>-<day>`, e.g.
 * `ot-sunday-25`, `ot-weekday-25-tue`, `lent-weekday-0-wed` (Ash Wednesday).
 */
import type { IsoDate } from '@lectio/shared';
import { isIsoDate } from '@lectio/shared';

/** Calendar seasons (the `season` of a calendar day) and their key prefix. */
export const SEASON_PREFIX = {
  'ordinary-time': 'ot',
  advent: 'advent',
  christmas: 'christmas',
  lent: 'lent',
  'paschal-triduum': 'triduum',
  easter: 'easter',
} as const;
export type Season = keyof typeof SEASON_PREFIX;

export const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

const PREFIXES = Object.values(SEASON_PREFIX).join('|');

/** A proper-of-time key. Week 0 is the days before a season's first Sunday. */
export const PROPER_OF_TIME_KEY = new RegExp(
  `^(?:${PREFIXES})-(?:sunday-(?:0|[1-9][0-9]?)|weekday-(?:0|[1-9][0-9]?)-(?:mon|tue|wed|thu|fri|sat))$`,
);

/** A celebration or common id: lower-case kebab-case, as in the calendar schema. */
export const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Day of the week of an ISO date. Throws a RangeError for an invalid date. */
export function weekdayOf(date: IsoDate): Weekday {
  if (!isIsoDate(date)) throw new RangeError(`Not an ISO date (YYYY-MM-DD): ${JSON.stringify(date)}`);
  return WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()] as Weekday;
}

/** The proper-of-time key for a date in a season and week. */
export function properOfTimeKey(date: IsoDate, season: Season, week: number): string {
  const day = weekdayOf(date);
  const prefix = SEASON_PREFIX[season];
  return day === 'sun' ? `${prefix}-sunday-${week}` : `${prefix}-weekday-${week}-${day}`;
}

/** Whether a proper-of-time key names a Sunday. */
export function isSundayKey(key: string): boolean {
  return /-sunday-\d+$/.test(key);
}

const SEASON_ORDER: readonly string[] = ['advent', 'christmas', 'lent', 'triduum', 'easter', 'ot'];
const POT_PARTS = /^([a-z]+)-(?:sunday-(\d+)|weekday-(\d+)-([a-z]{3}))$/;

/**
 * Orders keys for the data files: proper-of-time keys by season, week and day (Sunday first),
 * anything else alphabetically after them, with numbers compared as numbers.
 */
export function compareKeys(a: string, b: string): number {
  const pa = POT_PARTS.exec(a);
  const pb = POT_PARTS.exec(b);
  if (pa && pb) {
    const rank = (m: RegExpExecArray): number[] => [
      SEASON_ORDER.indexOf(m[1] as string),
      Number(m[2] ?? m[3]),
      m[2] === undefined ? WEEKDAYS.indexOf(m[4] as Weekday) : 0,
    ];
    const [ra, rb] = [rank(pa), rank(pb)];
    for (let i = 0; i < 3; i += 1) if (ra[i] !== rb[i]) return (ra[i] as number) - (rb[i] as number);
    return 0;
  }
  if (pa) return -1;
  if (pb) return 1;
  return a.localeCompare(b, 'en', { numeric: true });
}
