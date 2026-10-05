/**
 * The Kiswahili API mirror, `/api/v1/sw/…` (L-113): every endpoint against the fixture content root, validated
 * against the same schemas as the English API. Mt 20 has an approved, fresh Kiswahili translation; the Isaiah
 * passage is pending and stays out, as in English.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ResolvedDay } from '@lectio/content';
import {
  validateApiCalendar,
  validateApiDay,
  validateApiPassage,
  validateApiPassageIndex,
  validateApiUpcoming,
} from '@lectio/schema/api';
import { formatErrors } from '@lectio/schema/common';
import type { TranslatedPassage } from '@lectio/schema/translated-passage';
import type { APIContext } from 'astro';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { apiDay, apiPassage, apiPassageIndex } from '../../../../lib/api.ts';
import { localeRepo, translationSource } from '../../../../lib/notes-locale.ts';
import { siteContext } from '../../../../lib/site.ts';

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..');

// The documents' shapes, spelled out: `astro check` sees the schema package's inferred types as `any`.
interface NotesDoc {
  locale: string;
  summary: string;
  translationNotes: { id: string; anchor: string; verse: string }[];
  sources: { id: string }[];
}
interface DayDoc {
  masses: { readings: { slot: string; summary?: string | null; passage?: NotesDoc | null }[] }[];
}
interface PassageDoc {
  passage: NotesDoc;
}
interface PassageIndexDoc {
  passages: { key: string; summary: string }[];
}
interface CalendarDoc {
  days: DayDoc[];
}
interface UpcomingDoc extends CalendarDoc {
  from: string;
}

interface StaticPath {
  params: Record<string, string>;
  props: { document: unknown };
}
interface Endpoint {
  GET: (context: APIContext<{ document: unknown }>) => Response;
  getStaticPaths?: () => StaticPath[];
}

const body = async (endpoint: Endpoint, props: { document: unknown } = { document: null }): Promise<unknown> =>
  (await endpoint.GET({ props } as unknown as APIContext<{ document: unknown }>).json()) as unknown;

function valid(validate: ((value: unknown) => boolean) & { errors?: unknown }, value: unknown): void {
  const ok = validate(value);
  expect(formatErrors(ok ? [] : (validate.errors as Parameters<typeof formatErrors>[0]))).toEqual([]);
}

let days: Endpoint;
let calendar: Endpoint;
let passages: Endpoint;
let passageIndex: Endpoint;
let upcoming: Endpoint;

beforeAll(async () => {
  vi.stubEnv('LECTIO_CONFIG', 'apps/web/test/lectio.config.fixture.json');
  vi.stubEnv('LECTIO_DATE', '2026-09-20');
  vi.stubEnv('INIT_CWD', webRoot);
  days = (await import('./days/[date].json.ts')) as Endpoint;
  calendar = (await import('./calendar/[year].json.ts')) as Endpoint;
  passages = (await import('./passages/[key].json.ts')) as Endpoint;
  passageIndex = (await import('./passages/index.json.ts')) as Endpoint;
  upcoming = (await import('./upcoming.json.ts')) as Endpoint;
});

afterAll(() => {
  vi.unstubAllEnvs();
});

describe('/api/v1/sw/', () => {
  it('days/{date}.json carries the Kiswahili notes of a reviewed translation', async () => {
    const path = days.getStaticPaths?.().find(({ params }) => params.date === '2026-09-20') as StaticPath;
    const day = (await body(days, path.props)) as DayDoc;
    valid(validateApiDay, day);
    const readings = day.masses.flatMap((mass) => mass.readings);
    const gospel = readings.find((reading) => reading.slot === 'gospel');
    expect(gospel?.passage?.locale).toBe('sw');
    expect(gospel?.passage?.summary).toMatch(/^Mwenye shamba/);
    expect(gospel?.passage?.translationNotes[0]).toMatchObject({ id: 'v15-evil-eye', anchor: 'wivu', verse: '20:15' });
    // Sources stay the English file's, so citations match in both languages.
    expect(gospel?.passage?.sources.map((source) => source.id)).toContain('davies-allison');
    expect(readings.find((reading) => reading.slot === 'first-reading')?.passage).toBeNull();
  });

  it('passages/{key}.json and passages/index.json exist only for approved passages, in Kiswahili', async () => {
    const paths = passages.getStaticPaths?.() ?? [];
    expect(paths.map(({ params }) => params.key)).toEqual(['MT.20.1-16']);
    const passage = (await body(passages, paths[0]?.props)) as PassageDoc;
    valid(validateApiPassage, passage);
    expect(passage.passage.locale).toBe('sw');
    const index = (await body(passageIndex)) as PassageIndexDoc;
    valid(validateApiPassageIndex, index);
    expect(index.passages.map(({ key, summary }) => [key, summary.slice(0, 12)])).toEqual([
      ['MT.20.1-16', 'Mwenye shamb'],
    ]);
  });

  it('calendar/{year}.json and upcoming.json carry Kiswahili summaries', async () => {
    const [year] = calendar.getStaticPaths?.() ?? [];
    const document = (await body(calendar, year?.props)) as CalendarDoc;
    valid(validateApiCalendar, document);
    const summaries = (d: DayDoc[]) =>
      d.flatMap((day) => day.masses.flatMap((mass) => mass.readings.flatMap((r) => r.summary ?? [])));
    expect(summaries(document.days)).toContain(passageSummary);
    const next = (await body(upcoming)) as UpcomingDoc;
    valid(validateApiUpcoming, next);
    expect(next.from).toBe('2026-09-20');
    expect(summaries(next.days)).toContain(passageSummary);
  });
});

describe('/api/v1/sw/ without a reviewed, up-to-date translation', () => {
  const { repo } = siteContext({ cwd: webRoot, env: { LECTIO_CONFIG: 'apps/web/test/lectio.config.fixture.json' } });
  const translation = translationSource(repo.root)('sw', 'MT.20.1-16') as TranslatedPassage;
  const cases: [string, TranslatedPassage][] = [
    ['a stale translation', { ...translation, sourceSha256: '0'.repeat(64) }],
    ['a pending translation', { ...translation, review: { status: 'pending', reviewers: [] } }],
  ];

  for (const [name, broken] of cases) {
    it(`falls back to the English notes, marked en, for ${name}`, () => {
      const sw = localeRepo(repo, 'sw', { translations: () => broken });
      const day = apiDay(sw.resolveDay('2026-09-20') as ResolvedDay) as DayDoc;
      valid(validateApiDay, day);
      const gospel = day.masses.flatMap((mass) => mass.readings).find((reading) => reading.slot === 'gospel');
      expect(gospel?.passage?.locale).toBe('en');
      expect(gospel?.passage?.summary).toMatch(/^A landowner pays/);
      const passage = apiPassage(sw, 'MT.20.1-16') as PassageDoc;
      valid(validateApiPassage, passage);
      expect(passage.passage).toMatchObject({ locale: 'en', summary: expect.stringMatching(/^A landowner/) as string });
      const index = apiPassageIndex(sw) as PassageIndexDoc;
      expect(index.passages[0]?.summary).toMatch(/^A landowner/);
    });
  }
});

const passageSummary =
  'Mwenye shamba anawalipa walioajiriwa mwisho sawa na wa kwanza, na kuuliza kama wema wake ni sababu ya kinyongo.';
