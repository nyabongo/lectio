/**
 * ISO calendar-date helpers (`YYYY-MM-DD`). Dates are plain strings so they are
 * safe as JSON keys and file names; arithmetic happens in UTC so no local
 * timezone or DST transition can shift a day.
 */

/** A calendar date in `YYYY-MM-DD` form. */
export type IsoDate = string;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

/** True when `value` is a real calendar date in `YYYY-MM-DD` form (leap years included). */
export function isIsoDate(value: unknown): value is IsoDate {
  if (typeof value !== 'string') return false;
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function toUtcMs(date: IsoDate): number {
  if (!isIsoDate(date)) throw new RangeError(`Not an ISO date (YYYY-MM-DD): ${JSON.stringify(date)}`);
  return Date.parse(`${date}T00:00:00Z`);
}

function fromUtcMs(ms: number): IsoDate {
  return new Date(ms).toISOString().slice(0, 10);
}

/** `date` plus `days` (negative to go back). */
export function addDays(date: IsoDate, days: number): IsoDate {
  if (!Number.isInteger(days)) throw new RangeError(`days must be an integer, got ${days}`);
  return fromUtcMs(toUtcMs(date) + days * DAY_MS);
}

/** Every date from `from` to `to`, both inclusive. Empty when `to` is before `from`. */
export function dateRange(from: IsoDate, to: IsoDate): IsoDate[] {
  const start = toUtcMs(from);
  const end = toUtcMs(to);
  const dates: IsoDate[] = [];
  for (let ms = start; ms <= end; ms += DAY_MS) dates.push(fromUtcMs(ms));
  return dates;
}

/** The calendar date of `instant` as seen in an IANA `timeZone`, e.g. `Africa/Nairobi`. */
export function toIsoDateInZone(instant: Date, timeZone: string): IsoDate {
  if (Number.isNaN(instant.getTime())) throw new RangeError('Invalid Date');
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const field = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${String(field['year'])}-${String(field['month'])}-${String(field['day'])}`;
}
