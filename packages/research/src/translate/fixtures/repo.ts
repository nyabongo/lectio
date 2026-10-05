/**
 * A small in-memory content repository for the translate tests: two calendar days (references
 * only) and English passages derived from the Mt 20 seed under other keys. Commentary only.
 */
import { readFileSync } from 'node:fs';

import type { ContentRepo } from '@lectio/content';
import type { CalendarYear } from '@lectio/schema/calendar';
import type { Passage } from '@lectio/schema/passage';

export const SEED = JSON.parse(
  readFileSync(new URL('../../../../../passages/MT.20.1-16.json', import.meta.url), 'utf8'),
) as Passage;

const APPROVED: Passage['review'] = {
  status: 'approved',
  method: 'human',
  reviewers: ['nyabongo'],
  approvedVia: 'label',
  lastReviewedAt: '2026-10-01T09:00:00Z',
};

/** The seed under another key, approved unless `pending`. */
export function passageAt(key: string, ref: string, pending = false): Passage {
  return { ...structuredClone(SEED), key, ref, ...(pending ? {} : { review: APPROVED }) };
}

const reading = (slot: string, ref: string, key: string): Record<string, string> => ({
  slot,
  ref,
  key,
  linkout: 'https://www.drbo.org/',
});

function day(date: string, readings: Record<string, string>[]): Record<string, unknown> {
  return {
    date,
    season: 'ordinary-time',
    seasonWeek: 25,
    sundayCycle: 'A',
    weekdayCycle: 'II',
    celebrations: [{ id: 'ot', name: 'Ordinary Time', rank: 'sunday', colour: 'green' }],
    masses: [{ id: 'day', label: 'Mass of the day', readings }],
    lectionaryMissing: false,
  };
}

export const CALENDAR = {
  year: 2026,
  region: 'kenya',
  generatedBy: 'translate test',
  days: [
    // The gospel twice on one day: the day is listed once among its dates.
    day('2026-09-21', [
      reading('gospel', 'Mt 20:1-16a', 'MT.20.1-16'),
      reading('psalm', 'Ps 23', 'PS.23'),
      reading('gospel', 'Mt 20:1-16a', 'MT.20.1-16'),
    ]),
    day('2026-09-20', [
      reading('first-reading', 'Is 55:6-9', 'IS.55.6-9'),
      reading('psalm', 'Ps 145', 'PS.145'),
      reading('second-reading', 'Phil 1:20c-24, 27a', 'PHIL.1.20-24_1.27'),
      reading('gospel', 'Mt 20:1-16a', 'MT.20.1-16'),
    ]),
    day('2026-12-25', [reading('gospel', 'Jn 1:1-18', 'JN.1.1-18')]),
  ],
} as unknown as CalendarYear;

/** MT and PS.23 and JN approved, IS pending, PS.145 approved, PHIL missing. */
export const PASSAGES: Readonly<Record<string, Passage>> = {
  'MT.20.1-16': passageAt('MT.20.1-16', 'Mt 20:1-16a'),
  'IS.55.6-9': passageAt('IS.55.6-9', 'Is 55:6-9', true),
  'PS.145': passageAt('PS.145', 'Ps 145'),
  'PS.23': passageAt('PS.23', 'Ps 23'),
  'JN.1.1-18': passageAt('JN.1.1-18', 'Jn 1:1-18'),
};

export const REPO: Pick<ContentRepo, 'calendarYear' | 'passage' | 'datesForPassage'> = {
  calendarYear: (year) => (year === 2026 ? CALENDAR : null),
  passage: (key) => PASSAGES[key] ?? null,
  datesForPassage: (key) =>
    CALENDAR.days
      .filter((d) => d.masses.some((m) => m.readings.some((r) => r.key === key)))
      .map((d) => d.date)
      .sort(),
};
