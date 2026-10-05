import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_CONFIG } from '@lectio/config';
import { openRepo } from '@lectio/content';
import type { ContentFs, ContentRepo } from '@lectio/content';
import {
  validateApiCalendar,
  validateApiDay,
  validateApiIndex,
  validateApiPassage,
  validateApiPassageIndex,
  validateApiUpcoming,
} from '@lectio/schema/api';
import type {
  ApiDay,
  ApiDayReading,
  ApiDaySummary,
  ApiNotes,
  ApiPassageIndex,
  ApiPassageIndexEntry,
  ApiReadingSummary,
} from '@lectio/schema/api';
import { formatErrors } from '@lectio/schema/common';
import type { Passage } from '@lectio/schema/passage';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  API_ENDPOINTS,
  apiCalendar,
  apiContext,
  apiDay,
  apiDays,
  apiFiles,
  apiIndex,
  apiNotes,
  apiPassage,
  apiPassageIndex,
  apiPath,
  apiRootUrl,
  apiUpcoming,
  approvedPassages,
  calendarStaticPaths,
  dayStaticPaths,
  jsonResponse,
  passageStaticPaths,
  upcomingWindow,
} from './api.ts';
import type { ApiContext } from './api.ts';
import { siteContext } from './site.ts';

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, '../..');
const fixtureConfig = 'apps/web/test/lectio.config.fixture.json';
const FIXTURE_DATE = '2026-09-20';
const PENDING = 'IS.55.6-9';
const APPROVED = 'MT.20.1-16';

function fixtureContext(date = FIXTURE_DATE): ApiContext {
  const { config, repo } = siteContext({ cwd: webRoot, env: { LECTIO_CONFIG: fixtureConfig } });
  return { config, repo, date };
}

/**
 * An in-memory repository at `/mem`: `files` maps repository-relative paths to contents, and `listed` adds names a
 * directory lists without a readable file behind them.
 */
function memoryRepo(files: Readonly<Record<string, string>> = {}, listed: readonly string[] = []): ContentRepo {
  const missing = () => Object.assign(new Error('missing'), { code: 'ENOENT' });
  const fs: ContentFs = {
    readFile: (path) => {
      const text = files[path.replace(/^\/mem\//, '')];
      if (text === undefined) throw missing();
      return text;
    },
    readdir: (path) => {
      const dir = `${path.replace(/^\/mem\/?/, '')}/`;
      return [...Object.keys(files), ...listed]
        .filter((file) => file.startsWith(dir))
        .map((file) => file.slice(dir.length));
    },
  };
  return openRepo('/mem', { fs });
}

type Validator = ((data: unknown) => boolean) & { errors?: Parameters<typeof formatErrors>[0] };

function validatorFor(path: string): Validator {
  if (path === 'index.json') return validateApiIndex;
  if (path === 'upcoming.json') return validateApiUpcoming;
  if (path === 'passages/index.json') return validateApiPassageIndex;
  if (path.startsWith('passages/')) return validateApiPassage;
  if (path.startsWith('days/')) return validateApiDay;
  if (path.startsWith('calendar/')) return validateApiCalendar;
  throw new Error(`unexpected API path ${path}`);
}

function readingOf(day: ApiDay, key: string): ApiDayReading | undefined {
  return day.masses
    .flatMap((mass: ApiDay['masses'][number]) => mass.readings)
    .find((reading: ApiDayReading) => reading.key === key);
}

describe('API built from the fixture content root', () => {
  const files = apiFiles(fixtureContext());

  it('publishes every endpoint of v1', () => {
    expect([...files.keys()].sort()).toEqual([
      'calendar/2026.json',
      'days/2026-09-19.json',
      'days/2026-09-20.json',
      'days/2026-09-21.json',
      'index.json',
      `passages/${APPROVED}.json`,
      'passages/index.json',
      'upcoming.json',
    ]);
  });

  it.each([...files.keys()])('%s validates against its API schema', (path) => {
    const validate = validatorFor(path);
    const document = JSON.parse(JSON.stringify(files.get(path))) as unknown;
    const ok = validate(document);
    expect(formatErrors(ok ? [] : validate.errors)).toEqual([]);
    expect(ok).toBe(true);
  });

  it('leaves the pending passage out everywhere', () => {
    expect(files.has(`passages/${PENDING}.json`)).toBe(false);
    const index = files.get('passages/index.json') as ApiPassageIndex;
    expect(index.passages.map((entry: ApiPassageIndexEntry) => entry.key)).toEqual([APPROVED]);
    const day = files.get('days/2026-09-20.json') as ApiDay;
    expect(readingOf(day, PENDING)?.passage).toBeNull();
    const everything = JSON.stringify([...files.values()]);
    // The pending note's summary, context title and run id never reach the API.
    expect(everything).not.toContain('Second Isaiah');
    expect(everything).not.toContain('Seek the Lord while he may be found');
    expect(everything).not.toContain('fixture-is-55-6-9');
  });

  it('never publishes provenance or reviewer handles', () => {
    const everything = JSON.stringify([...files.values()]);
    for (const field of ['provenance', 'costUsd', 'runId', 'promptVersion', 'reviewers', 'fixture-reviewer']) {
      expect(everything).not.toContain(field);
    }
  });

  it('inlines the approved notes with null audio and a reader-facing review', () => {
    const day = files.get('days/2026-09-20.json') as ApiDay;
    const notes = readingOf(day, APPROVED)?.passage as ApiNotes;
    expect(notes.key).toBe(APPROVED);
    expect(notes.context.audio).toBeNull();
    expect(notes.translationNotes.map((note: ApiNotes['translationNotes'][number]) => note.audio)).toEqual([
      null,
      null,
    ]);
    expect(notes.review).toEqual({ status: 'approved', method: 'human', lastReviewedAt: '2026-09-03T17:05:00Z' });
    expect(day.colour).toBe('green');
    expect((files.get('days/2026-09-21.json') as ApiDay).colour).toBe('red');
  });

  it('lists the dates each approved passage is read on', () => {
    const passage = files.get(`passages/${APPROVED}.json`) as ReturnType<typeof apiPassage>;
    expect(passage?.dates).toEqual(['2026-09-20']);
  });

  it('summarises readings in the calendar with hasNotes and the approved summary only', () => {
    const calendar = files.get('calendar/2026.json') as NonNullable<ReturnType<typeof apiCalendar>>;
    const readings = calendar.days.find((day: ApiDaySummary) => day.date === FIXTURE_DATE)?.masses[0]?.readings ?? [];
    expect(
      readings.map((reading: ApiReadingSummary) => [reading.key, reading.hasNotes, reading.summary !== null]),
    ).toEqual([
      [PENDING, false, false],
      ['PS.145.2-3_145.8-9_145.17-18', false, false],
      ['PHIL.1.20-24_1.27', false, false],
      [APPROVED, true, true],
    ]);
    expect(calendar.region).toBe('kenya');
  });

  it('describes the build in index.json', () => {
    expect(files.get('index.json')).toEqual({
      apiVersion: 1,
      buildDate: FIXTURE_DATE,
      timezone: 'Africa/Nairobi',
      defaultLocale: 'en',
      locales: ['en'],
      apiRoot: 'https://nyabongo.github.io/lectio/api/v1/',
      years: [2026],
      dates: { first: '2026-09-19', last: '2026-09-21' },
      passageCount: 1,
      endpoints: API_ENDPOINTS,
    });
  });
});

describe('upcoming.json', () => {
  it('covers the build date and the 13 days after it', () => {
    expect(upcomingWindow('2026-09-20')).toEqual({ from: '2026-09-20', to: '2026-10-03' });
    expect(upcomingWindow('2026-12-25')).toEqual({ from: '2026-12-25', to: '2027-01-07' });
  });

  it('lists only the dates the calendar has, from the build date on', () => {
    const upcoming = apiUpcoming(fixtureContext());
    expect(upcoming.timezone).toBe('Africa/Nairobi');
    expect(upcoming.days.map((day: ApiDaySummary) => day.date)).toEqual(['2026-09-20', '2026-09-21']);
    expect(apiUpcoming(fixtureContext('2026-09-19')).days.map((day: ApiDaySummary) => day.date)).toEqual([
      '2026-09-19',
      '2026-09-20',
      '2026-09-21',
    ]);
    expect(apiUpcoming(fixtureContext('2026-10-01')).days).toEqual([]);
  });
});

describe('notes', () => {
  const { repo } = fixtureContext();
  const approved = repo.passage(APPROVED) as Passage;

  it('are null for a missing or pending passage', () => {
    expect(apiNotes(null)).toBeNull();
    expect(apiNotes(undefined)).toBeNull();
    expect(apiNotes(repo.passage(PENDING))).toBeNull();
    expect(apiPassage(repo, PENDING)).toBeNull();
    expect(apiPassage(repo, 'JN.3.16')).toBeNull();
  });

  it('report lastReviewedAt as null when the review has none', () => {
    const { lastReviewedAt: _dropped, ...review } = approved.review;
    expect(apiNotes({ ...approved, review })?.review.lastReviewedAt).toBeNull();
  });

  it('refuse an approved passage without a review method', () => {
    const { method: _dropped, ...review } = approved.review;
    expect(() => apiNotes({ ...approved, review })).toThrow(/MT\.20\.1-16 has no review method/);
  });

  it('do not share arrays with the repository cache', () => {
    const notes = apiNotes(approved) as ApiNotes;
    expect(notes.context.paragraphs).not.toBe(approved.context.paragraphs);
    expect(notes.claims[0]?.sourceIds).not.toBe(approved.claims[0]?.sourceIds);
  });
});

describe('an empty repository', () => {
  const context: ApiContext = { config: DEFAULT_CONFIG, repo: memoryRepo(), date: FIXTURE_DATE };

  it('still publishes a valid index, upcoming and passage index', () => {
    const files = apiFiles(context);
    expect([...files.keys()].sort()).toEqual(['index.json', 'passages/index.json', 'upcoming.json']);
    expect(apiIndex(context)).toMatchObject({ years: [], dates: null, passageCount: 0 });
    for (const [path, document] of files) expect(validatorFor(path)(document)).toBe(true);
  });

  it('has no calendar, days or passages', () => {
    expect(apiCalendar(context.repo, 2026)).toBeNull();
    expect(apiDays(context.repo)).toEqual([]);
    expect(approvedPassages(context.repo)).toEqual([]);
  });

  it('skips a listed calendar year whose file cannot be found', () => {
    const repo = memoryRepo({}, ['calendar/2027.json']);
    expect(apiIndex({ ...context, repo })).toMatchObject({ years: [2027], dates: null });
  });

  it('reports a null lastReviewedAt for an approved passage that has none', () => {
    const { repo: fixtureRepo } = fixtureContext();
    const passage = fixtureRepo.passage(APPROVED) as Passage;
    const { lastReviewedAt: _dropped, ...review } = passage.review;
    const repo = memoryRepo({ [`passages/${APPROVED}.json`]: JSON.stringify({ ...passage, review }) });
    const index = apiPassageIndex(repo);
    expect(index.passages.map((entry: ApiPassageIndexEntry) => entry.lastReviewedAt)).toEqual([null]);
    expect(validateApiPassageIndex(index)).toBe(true);
  });
});

describe('paths and URLs', () => {
  it('resolves the API root against the site URL', () => {
    expect(apiRootUrl(DEFAULT_CONFIG)).toBe('https://nyabongo.github.io/lectio/api/v1/');
    const site = { ...DEFAULT_CONFIG.site, baseUrl: 'https://lectio.example/app' };
    expect(apiRootUrl({ site })).toBe('https://lectio.example/app/api/v1/');
  });

  it('fills endpoint templates', () => {
    expect(apiPath('index')).toBe('index.json');
    expect(apiPath('day', { date: '2026-09-20' })).toBe('days/2026-09-20.json');
    expect(apiPath('passage', { key: APPROVED })).toBe(`passages/${APPROVED}.json`);
    expect(apiPath('calendar', { year: '2026' })).toBe('calendar/2026.json');
    expect(() => apiPath('day')).toThrow('day needs a value for {date}');
  });

  it('builds one static path per day, approved passage and year', () => {
    const { repo } = fixtureContext();
    expect(dayStaticPaths(repo).map((path) => path.params.date)).toEqual(['2026-09-19', '2026-09-20', '2026-09-21']);
    expect(dayStaticPaths(repo)[1]?.props.document).toEqual(apiDay(repo.resolveDay('2026-09-20')!));
    expect(passageStaticPaths(repo).map((path) => path.params.key)).toEqual([APPROVED]);
    expect(calendarStaticPaths(repo).map((path) => path.params.year)).toEqual(['2026']);
  });

  it('serves compact JSON', async () => {
    const response = jsonResponse({ a: [1, 2] });
    expect(response.headers.get('Content-Type')).toBe('application/json; charset=utf-8');
    expect(await response.text()).toBe('{"a":[1,2]}');
  });
});

describe('endpoints', () => {
  beforeAll(() => {
    vi.stubEnv('LECTIO_CONFIG', fixtureConfig);
    vi.stubEnv('LECTIO_DATE', FIXTURE_DATE);
    vi.stubEnv('INIT_CWD', webRoot);
  });

  afterAll(() => {
    vi.unstubAllEnvs();
  });

  it('apiContext reads the build config and date', () => {
    const context = apiContext();
    expect(context.date).toBe(FIXTURE_DATE);
    expect(context.repo.passageKeys()).toContain(APPROVED);
  });

  it('write the documents from src/lib/api.ts', async () => {
    const expected = apiFiles(fixtureContext());
    const index = await import('../pages/api/v1/index.json.ts');
    const upcoming = await import('../pages/api/v1/upcoming.json.ts');
    const passages = await import('../pages/api/v1/passages/index.json.ts');
    const days = await import('../pages/api/v1/days/[date].json.ts');
    const passage = await import('../pages/api/v1/passages/[key].json.ts');
    const calendar = await import('../pages/api/v1/calendar/[year].json.ts');
    const body = async (response: Response) => JSON.parse(await response.text()) as unknown;

    expect(await body(index.GET())).toEqual(expected.get('index.json'));
    expect(await body(upcoming.GET())).toEqual(expected.get('upcoming.json'));
    expect(await body(passages.GET())).toEqual(expected.get('passages/index.json'));
    for (const [module, prefix] of [
      [days, 'days'],
      [passage, 'passages'],
      [calendar, 'calendar'],
    ] as const) {
      for (const path of module.getStaticPaths()) {
        const name = Object.values(path.params)[0] as string;
        const response = module.GET({ props: path.props } as Parameters<typeof module.GET>[0]);
        expect(await body(response)).toEqual(expected.get(`${prefix}/${name}.json`));
      }
    }
  });
});
