import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_CONFIG } from '@lectio/config';
import type { ContentFs } from '@lectio/content';
import { describe, expect, it } from 'vitest';

import {
  astroSiteOptions,
  contentRootPath,
  dayOrNearest,
  normaliseBase,
  readingSummaries,
  siteContext,
  siteDate,
  todayIn,
  withBase,
} from './site.ts';

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, '../..');
const repoRoot = resolve(webRoot, '../..');
const fixtureConfig = 'apps/web/test/lectio.config.fixture.json';
const fixtureContent = join(webRoot, 'test/fixtures/content');

function fixtureContext() {
  return siteContext({ cwd: webRoot, env: { LECTIO_CONFIG: fixtureConfig } });
}

describe('site options', () => {
  it('normalises the base path for Astro', () => {
    expect(normaliseBase('')).toBe('/');
    expect(normaliseBase('/')).toBe('/');
    expect(normaliseBase('/lectio')).toBe('/lectio/');
    expect(normaliseBase('lectio/')).toBe('/lectio/');
    expect(normaliseBase('//a/b//')).toBe('/a/b/');
  });

  it('takes site and base from config.site', () => {
    expect(astroSiteOptions(DEFAULT_CONFIG)).toEqual({ site: 'https://nyabongo.github.io/lectio/', base: '/lectio/' });
    expect(
      astroSiteOptions({ site: { ...DEFAULT_CONFIG.site, baseUrl: 'https://lectio.example/', basePath: '' } }),
    ).toEqual({ site: 'https://lectio.example/', base: '/' });
  });

  it('builds base-aware URLs', () => {
    expect(withBase('/lectio/', 'calendar/')).toBe('/lectio/calendar/');
    expect(withBase('/lectio', '/settings/')).toBe('/lectio/settings/');
    expect(withBase('/', 'about/')).toBe('/about/');
    expect(withBase('/lectio/')).toBe('/lectio/');
  });
});

describe('content root', () => {
  it('resolves config.content.root against the repository root', () => {
    expect(contentRootPath({ content: { root: 'apps/web/test/fixtures/content' } }, webRoot)).toBe(fixtureContent);
    expect(contentRootPath({ content: { root: '.' } }, here)).toBe(repoRoot);
  });

  it('keeps an absolute root as it is', () => {
    expect(contentRootPath({ content: { root: '/srv/content' } }, webRoot)).toBe('/srv/content');
  });
});

describe('siteContext', () => {
  it('loads the config LECTIO_CONFIG names and opens its content root', () => {
    const { config, contentRoot, repo } = fixtureContext();
    expect(config.content.root).toBe('apps/web/test/fixtures/content');
    expect(contentRoot).toBe(fixtureContent);
    expect(repo.root).toBe(fixtureContent);
    expect(repo.years()).toEqual([2026]);
    expect(repo.passageKeys()).toEqual(['IS.55.6-9', 'MT.20.1-16', 'NM.21.4-9']);
  });

  it('defaults to the repository config when no file is named', () => {
    const { config, contentRoot } = siteContext({ cwd: webRoot, env: {} });
    expect(config.site.basePath).toBe('/lectio');
    expect(contentRoot).toBe(repoRoot);
  });

  it('starts from the process working directory when neither cwd nor INIT_CWD is given', () => {
    const { contentRoot } = siteContext({ env: { LECTIO_CONFIG: fixtureConfig } });
    // Vitest runs inside the repository, so the repository root is found from there.
    expect(contentRoot).toBe(fixtureContent);
  });

  it('starts from INIT_CWD when no cwd is given', () => {
    const { contentRoot } = siteContext({ env: { INIT_CWD: webRoot, LECTIO_CONFIG: fixtureConfig } });
    expect(contentRoot).toBe(fixtureContent);
  });

  it('passes a custom file system to the repository', () => {
    const fs: ContentFs = {
      readFile: () => {
        throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      },
      readdir: () => ['2031.json'],
    };
    const { repo } = siteContext({ cwd: webRoot, env: { LECTIO_CONFIG: fixtureConfig }, fs });
    expect(repo.years()).toEqual([2031]);
  });

  it('caches the build context when called without options', () => {
    const first = siteContext();
    expect(siteContext()).toBe(first);
    expect(fixtureContext()).not.toBe(first);
  });
});

describe('dates', () => {
  it("finds today's date in the site time zone", () => {
    const lateEvening = new Date('2026-09-19T22:30:00Z');
    expect(todayIn('Africa/Nairobi', lateEvening)).toBe('2026-09-20');
    expect(todayIn('UTC', lateEvening)).toBe('2026-09-19');
    expect(todayIn('UTC')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('siteDate', () => {
  const now = new Date('2026-09-19T22:30:00Z');

  it('uses LECTIO_DATE when it is set', () => {
    expect(siteDate(DEFAULT_CONFIG, { LECTIO_DATE: '2026-09-20' }, now)).toBe('2026-09-20');
  });

  it('falls back to today in the site time zone', () => {
    expect(siteDate(DEFAULT_CONFIG, {}, now)).toBe('2026-09-20');
    expect(siteDate(DEFAULT_CONFIG, { LECTIO_DATE: '' }, now)).toBe('2026-09-20');
    expect(siteDate(DEFAULT_CONFIG)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('rejects a malformed LECTIO_DATE', () => {
    expect(() => siteDate(DEFAULT_CONFIG, { LECTIO_DATE: 'tomorrow' }, now)).toThrow(/LECTIO_DATE/);
  });
});

describe('dayOrNearest', () => {
  const { repo } = fixtureContext();

  it('returns the exact day when the calendar has it', () => {
    expect(dayOrNearest(repo, '2026-09-20')?.date).toBe('2026-09-20');
  });

  it('falls back to the latest earlier day with readings', () => {
    expect(dayOrNearest(repo, '2026-10-05')?.date).toBe('2026-09-21');
  });

  it('falls back to the first day of the year with readings when none is earlier', () => {
    expect(dayOrNearest(repo, '2026-01-10')?.date).toBe('2026-09-14');
  });

  it('returns null when the year has no calendar', () => {
    expect(dayOrNearest(repo, '2030-01-01')).toBeNull();
  });
});

describe('readingSummaries', () => {
  const { repo } = fixtureContext();

  it('lists the first Mass readings with approved summaries only', () => {
    const day = repo.resolveDay('2026-09-20');
    expect(day).not.toBeNull();
    const readings = readingSummaries(day as NonNullable<typeof day>);
    expect(readings.map((r) => [r.slot, r.ref])).toEqual([
      ['first-reading', 'Is 55:6-9'],
      ['psalm', 'Ps 145:2-3, 8-9, 17-18'],
      ['second-reading', 'Phil 1:20c-24, 27a'],
      ['gospel', 'Mt 20:1-16a'],
    ]);
    // Isaiah is pending review and the psalm has no notes: neither shows a summary.
    expect(readings.map((r) => r.summary === null)).toEqual([true, true, true, false]);
    expect(readings[3]?.linkout).toBe('https://www.drbo.org/chapter/47020.htm');
  });

  it('is empty for a day without Masses', () => {
    const day = repo.resolveDay('2026-09-19');
    expect(readingSummaries({ ...(day as NonNullable<typeof day>), masses: [] })).toEqual([]);
  });
});
