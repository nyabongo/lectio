/**
 * Test fixture: an in-memory content repository (calendar years and passages) behind
 * `openRepo`, so each test states exactly which readings exist and which notes are approved.
 * Passages carry fixture commentary only, never reading text.
 */
import { openRepo } from '@lectio/content';
import type { ContentFs, ContentRepo } from '@lectio/content';

const SLOTS = ['first-reading', 'psalm', 'second-reading', 'gospel'] as const;

/** Passage keys per Mass, by date: `{ '2026-12-30': [['IS.55.6-9', 'MT.20.1-16']] }`. */
export type FixtureDays = Readonly<Record<string, readonly (readonly string[])[]>>;

export interface FixtureRepo {
  readonly days: FixtureDays;
  /** Keys whose passage file exists and is approved. */
  readonly approved?: readonly string[];
  /** Keys whose passage file exists but is still pending review. */
  readonly pending?: readonly string[];
}

function calendarDay(date: string, masses: readonly (readonly string[])[]): unknown {
  return {
    date,
    season: 'ordinary-time',
    seasonWeek: 1,
    sundayCycle: 'A',
    weekdayCycle: 'II',
    celebrations: [{ id: 'fixture-day', name: 'Fixture day', rank: 'weekday', colour: 'green' }],
    masses: masses.map((keys, index) => ({
      id: index === 0 ? 'day' : `mass-${String(index)}`,
      label: 'Fixture Mass',
      readings: keys.map((key, slot) => ({
        slot: SLOTS[slot % SLOTS.length],
        ref: 'Fixture reference',
        key,
        linkout: 'https://www.drbo.org/chapter/47020.htm',
      })),
    })),
    lectionaryMissing: masses.length === 0,
  };
}

function passage(key: string, approved: boolean): unknown {
  return {
    key,
    ref: 'Fixture reference',
    locale: 'en',
    summary: 'Fixture commentary for the runway monitor tests.',
    context: { title: 'Fixture', paragraphs: ['Fixture commentary. [c1]'] },
    translationNotes: [],
    claims: [{ id: 'c1', text: 'A fixture claim.', sourceIds: ['s1'], sensitive: false }],
    sources: [{ id: 's1', type: 'print', citation: 'A fixture source, 2026' }],
    provenance: {
      generator: 'fake',
      runId: `fixture-${key}`,
      models: [],
      promptVersion: 'fixture',
      createdAt: '2026-09-01T08:00:00Z',
    },
    review: approved
      ? { status: 'approved', method: 'human', reviewers: ['fixture-reviewer'], approvedVia: 'label' }
      : { status: 'pending', reviewers: [] },
    schemaVersion: 1,
  };
}

/** The files of a fixture repository, keyed by repository-relative path. */
export function fixtureFiles({ days, approved = [], pending = [] }: FixtureRepo): Map<string, string> {
  const files = new Map<string, string>();
  const years = new Map<number, unknown[]>();
  for (const [date, masses] of Object.entries(days)) {
    const year = Number(date.slice(0, 4));
    years.set(year, [...(years.get(year) ?? []), calendarDay(date, masses)]);
  }
  for (const [year, list] of years) {
    files.set(
      `calendar/${String(year)}.json`,
      JSON.stringify({ year, region: 'kenya', generatedBy: 'fixture', days: list }),
    );
  }
  for (const key of approved) files.set(`passages/${key}.json`, JSON.stringify(passage(key, true)));
  for (const key of pending) files.set(`passages/${key}.json`, JSON.stringify(passage(key, false)));
  return files;
}

function missing(path: string): Error {
  return Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' });
}

/** An in-memory `ContentFs` rooted at `/repo`. */
export function memoryFs(files: ReadonlyMap<string, string>): ContentFs {
  const relative = (path: string): string => path.replace(/^\/repo\/?/, '');
  return {
    readFile(path) {
      const text = files.get(relative(path));
      if (text === undefined) throw missing(path);
      return text;
    },
    readdir(path) {
      const dir = `${relative(path)}/`;
      const names = [...files.keys()].filter((name) => name.startsWith(dir)).map((name) => name.slice(dir.length));
      if (names.length === 0) throw missing(path);
      return names;
    },
  };
}

/** A fresh content repository over the fixture (a new one per state, since `openRepo` caches). */
export function fixtureRepo(fixture: FixtureRepo): ContentRepo {
  return openRepo('/repo', { fs: memoryFs(fixtureFiles(fixture)) });
}
