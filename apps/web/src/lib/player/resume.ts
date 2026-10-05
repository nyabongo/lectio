/**
 * Where listening stopped, per day (L-085): the segment and the point in it, kept in `localStorage` under
 * `RESUME_KEY` so reopening a day's Listen page picks up there. Only the most recent `RESUME_DAYS` days are kept.
 *
 * Like the settings store, every read is tolerant (no storage, a throwing accessor, malformed JSON or a stale entry
 * fall back to the start of the queue) and every write is wrapped in try/catch.
 */
import type { SettingsStorage } from '../settings.ts';
import type { Source, StartPoint } from './queue.ts';

export const RESUME_KEY = 'lectio.listen';

/** How many days' resume points are kept. */
export const RESUME_DAYS = 14;

/**
 * A saved point: the segment id and the seconds (at 1×) into it, in the units of the `source` that was playing, and
 * that source's length of the segment, so the point can be carried over when the other source plays it next time
 * (`StartPoint` in queue.ts). Points saved without `source` are used as they are.
 */
export interface ResumePoint {
  readonly id: string;
  readonly position: number;
  readonly source?: Source | undefined;
  readonly duration?: number | null | undefined;
}

type ResumeRecord = Record<string, ResumePoint>;

const isLength = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;

/** `value` as a resume point, keeping only valid fields; `null` without a usable id and position. */
function toPoint(value: unknown): ResumePoint | null {
  if (typeof value !== 'object' || value === null) return null;
  const { id, position, source, duration } = value as Record<string, unknown>;
  if (typeof id !== 'string' || !isLength(position)) return null;
  if (source !== 'audio' && source !== 'speech') return { id, position };
  return { id, position, source, duration: isLength(duration) ? duration : null };
}

function read(storage: SettingsStorage | null): ResumeRecord {
  try {
    const parsed = JSON.parse(storage?.getItem(RESUME_KEY) ?? '{}') as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).flatMap(([day, value]) => {
        const point = toPoint(value);
        return point === null ? [] : [[day, point] as const];
      }),
    );
  } catch {
    return {};
  }
}

function write(storage: SettingsStorage | null, record: ResumeRecord): boolean {
  if (storage === null) return false;
  try {
    storage.setItem(RESUME_KEY, JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
}

/** The saved point for `date`, or `null`. */
export function loadResume(storage: SettingsStorage | null, date: string): ResumePoint | null {
  return read(storage)[date] ?? null;
}

/** Saves the point for `date` (dropping the oldest days beyond `RESUME_DAYS`); false when it could not be saved. */
export function saveResume(storage: SettingsStorage | null, date: string, point: ResumePoint): boolean {
  const saved = toPoint({ ...point, position: Math.max(0, point.position) }) as ResumePoint;
  const record = { ...read(storage), [date]: saved };
  const kept = Object.keys(record).sort().slice(-RESUME_DAYS);
  return write(storage, Object.fromEntries(kept.map((day) => [day, record[day] as ResumePoint])));
}

/** Forgets `date` (the queue was heard to the end). */
export function clearResume(storage: SettingsStorage | null, date: string): boolean {
  const record = read(storage);
  if (!Object.hasOwn(record, date)) return true;
  return write(storage, Object.fromEntries(Object.entries(record).filter(([day]) => day !== date)));
}

/** Where the queue starts for a saved point: the segment's index and the point in it, or the start when it is gone. */
export function resumeStart(point: ResumePoint | null, ids: readonly string[]): StartPoint {
  const index = point === null ? -1 : ids.indexOf(point.id);
  if (index < 0) return { index: 0, position: 0 };
  const { position, source, duration } = point as ResumePoint;
  return source === undefined ? { index, position } : { index, position, source, duration };
}
