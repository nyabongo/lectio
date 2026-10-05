/**
 * Where listening stopped, per day (L-085): the segment and the point in it, kept in `localStorage` under
 * `RESUME_KEY` so reopening a day's Listen page picks up there. Only the most recent `RESUME_DAYS` days are kept.
 *
 * Like the settings store, every read is tolerant (no storage, a throwing accessor, malformed JSON or a stale entry
 * fall back to the start of the queue) and every write is wrapped in try/catch.
 */
import type { SettingsStorage } from '../settings.ts';

export const RESUME_KEY = 'lectio.listen';

/** How many days' resume points are kept. */
export const RESUME_DAYS = 14;

/** A saved point: the segment id and the seconds (at 1×) into it. */
export interface ResumePoint {
  readonly id: string;
  readonly position: number;
}

type ResumeRecord = Record<string, ResumePoint>;

function isPoint(value: unknown): value is ResumePoint {
  if (typeof value !== 'object' || value === null) return false;
  const { id, position } = value as Record<string, unknown>;
  return typeof id === 'string' && typeof position === 'number' && Number.isFinite(position) && position >= 0;
}

function read(storage: SettingsStorage | null): ResumeRecord {
  try {
    const parsed = JSON.parse(storage?.getItem(RESUME_KEY) ?? '{}') as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([, point]) => isPoint(point))) as ResumeRecord;
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
  const record = { ...read(storage), [date]: { id: point.id, position: Math.max(0, point.position) } };
  const kept = Object.keys(record).sort().slice(-RESUME_DAYS);
  return write(storage, Object.fromEntries(kept.map((day) => [day, record[day] as ResumePoint])));
}

/** Forgets `date` (the queue was heard to the end). */
export function clearResume(storage: SettingsStorage | null, date: string): boolean {
  const record = read(storage);
  if (!Object.hasOwn(record, date)) return true;
  return write(storage, Object.fromEntries(Object.entries(record).filter(([day]) => day !== date)));
}

/** The queue position a saved point maps to: the segment's index and position, or the start when it is gone. */
export function resumeStart(
  point: ResumePoint | null,
  ids: readonly string[],
): { readonly index: number; readonly position: number } {
  const index = point === null ? -1 : ids.indexOf(point.id);
  return index < 0 ? { index: 0, position: 0 } : { index, position: (point as ResumePoint).position };
}
