import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG } from '@lectio/config';
import { FakeClock, FakeGitHubClient, createCostMeter } from '@lectio/providers';
import type { CostMeter } from '@lectio/providers';

import { UsageError } from '../plan/args.ts';
import { TRANSLATE_USAGE_FIXTURE, fakeTranslateLlm, pseudoTranslation } from './fixtures/fake-translation.ts';
import { PASSAGES, REPO } from './fixtures/repo.ts';
import { TRANSLATION_LABEL } from './publish.ts';
import { formatTranslateReport, fsReadTranslation, runTranslate } from './run.ts';
import type { RunTranslateDeps } from './run.ts';
import { assembleTranslation } from './translate.ts';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'lectio-translate-run-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const english = [PASSAGES['MT.20.1-16'], PASSAGES['PS.145'], PASSAGES['PS.23'], PASSAGES['IS.55.6-9']].filter(
  (p) => p !== undefined,
);

function deps(
  overrides: Partial<RunTranslateDeps> = {},
): RunTranslateDeps & { github: FakeGitHubClient; meter: CostMeter } {
  return {
    config: DEFAULT_CONFIG,
    clock: new FakeClock({ start: '2026-09-19T07:50:00Z' }),
    repo: REPO,
    github: new FakeGitHubClient(),
    llm: fakeTranslateLlm({ passages: english }),
    meter: createCostMeter({ pricing: DEFAULT_CONFIG.pricing, ceilingUsd: 25 }),
    contentRoot: dir,
    ...overrides,
  } as RunTranslateDeps & { github: FakeGitHubClient; meter: CostMeter };
}

describe('runTranslate', () => {
  it('translates the window, writes the files and opens one needs-review PR per translation', async () => {
    const d = deps();
    const report = await runTranslate(['--locale', 'sw', '--from', '2026-09-20', '--days', '2'], d);
    expect(report.runId).toBe('translate-20260919T075000Z');
    expect(report.results.map((result) => [result.key, result.status])).toEqual([
      ['PS.145', 'written'],
      ['MT.20.1-16', 'written'],
      ['PS.23', 'written'],
    ]);
    expect(report.published.every((outcome) => outcome.ok)).toBe(true);
    const prs = await d.github.listPrs();
    expect(prs.map((pr) => pr.head)).toEqual(['translate/sw/PS.145', 'translate/sw/MT.20.1-16', 'translate/sw/PS.23']);
    for (const pr of prs) expect(pr.labels).toContain('needs-review');
    const written = JSON.parse(await readFile(join(dir, 'passages/i18n/sw/MT.20.1-16.json'), 'utf8')) as unknown;
    expect(fsReadTranslation(dir)('sw', 'MT.20.1-16')).toEqual(written);
    expect(report.spentUsd).toBeGreaterThan(0);

    const text = formatTranslateReport(report);
    expect(text).toContain('translate sw: 2026-09-20 to 2026-09-21');
    expect(text).toContain('wrote passages/i18n/sw/MT.20.1-16.json');
    expect(text).toContain('opened PR #2');
    expect(text).toContain('skip IS.55.6-9: english-pending');
  });

  it('skips fresh translations on the next run, and re-translates stale ones', async () => {
    const first = deps();
    await runTranslate(['--locale', 'sw', '--from', '2026-09-20', '--days', '2'], first);
    await writeFile(join(dir, 'passages/i18n/sw/PS.23.json'), '{}');
    const again = await runTranslate(
      ['--locale', 'sw', '--from', '2026-09-20', '--days', '2'],
      deps({ github: first.github }),
    );
    expect(again.plan.skipped).toContainEqual(expect.objectContaining({ key: 'MT.20.1-16', reason: 'fresh' }));
    // An invalid file reads as no translation; its PR is still open.
    expect(again.plan.skipped).toContainEqual(expect.objectContaining({ key: 'PS.23', reason: 'open-pr' }));
    expect(formatTranslateReport(again)).toMatch(/skip PS\.23: open-pr \(#3\)/);
  });

  it('reports failures, unpublished translations and an exhausted budget', async () => {
    const github = new FakeGitHubClient();
    await github.createBranch({ name: 'translate/sw/MT.20.1-16' });
    const bad = {
      output: { ...pseudoTranslation(PASSAGES['PS.23'] as never), claims: [] },
      usage: TRANSLATE_USAGE_FIXTURE,
    };
    const report = await runTranslate(
      ['--locale', 'sw', '--from', '2026-09-20', '--days', '2', '--include-pending'],
      deps({
        github,
        llm: fakeTranslateLlm({ passages: [PASSAGES['MT.20.1-16'] as never], fallback: bad }),
        readTranslation: () => null,
      }),
    );
    expect(report.results.map((result) => [result.key, result.status])).toEqual([
      ['IS.55.6-9', 'failed'],
      ['PS.145', 'failed'],
      ['MT.20.1-16', 'written'],
      ['PS.23', 'failed'],
    ]);
    expect(report.published).toEqual([expect.objectContaining({ ok: false, key: 'MT.20.1-16' })]);
    const text = formatTranslateReport(report);
    expect(text).toMatch(/failed IS\.55\.6-9: generator: /);
    expect(text).toContain('not published MT.20.1-16: branch translate/sw/MT.20.1-16 exists without an open PR');

    const broke = await runTranslate(
      ['--locale', 'sw', '--from', '2026-09-20', '--days', '2', '--max', '1'],
      deps({ meter: createCostMeter({ pricing: DEFAULT_CONFIG.pricing, ceilingUsd: 0 }) }),
    );
    expect(broke.notStarted).toEqual(['PS.145']);
    expect(formatTranslateReport(broke)).toContain('not started PS.145: run budget spent');
  });

  it('reports a translation that went over its budget, and non-Error publish failures', async () => {
    const config = {
      ...DEFAULT_CONFIG,
      research: { ...DEFAULT_CONFIG.research, budget: { ...DEFAULT_CONFIG.research.budget, perPassageUsd: 0.0001 } },
    };
    const report = await runTranslate(['--locale', 'sw', '--from', '2026-09-20', '--only', 'PS.23'], deps({ config }));
    expect(report.results).toEqual([expect.objectContaining({ status: 'over-budget' })]);
    expect(formatTranslateReport(report)).toContain('over budget PS.23 (translate:sw:PS.23)');

    const github = new FakeGitHubClient();
    const throwing = {
      ...github,
      listPrs: (filter?: never) =>
        filter === undefined || (filter as { head?: string }).head === undefined
          ? github.listPrs()
          : Promise.reject('boom'),
    };
    const failed = await runTranslate(
      ['--locale', 'sw', '--from', '2026-09-20', '--only', 'PS.23'],
      deps({ github: throwing as never, base: 'main' }),
    );
    expect(failed.published).toEqual([expect.objectContaining({ ok: false, error: new Error('boom') })]);
  });

  it('rejects bad flags', async () => {
    await expect(runTranslate(['--locale', 'en'], deps())).rejects.toThrow(UsageError);
  });

  it('writes with the injected writer and formatter, and reports updated PRs', async () => {
    const writes: string[] = [];
    const report = await runTranslate(
      ['--locale', 'sw', '--from', '2026-09-20', '--only', 'PS.23'],
      deps({
        writeFile: (path) => {
          writes.push(path);
          return Promise.resolve();
        },
        format: (json) => Promise.resolve(json),
      }),
    );
    expect(writes).toEqual([join(dir, 'passages/i18n/sw/PS.23.json')]);
    const published = report.published.map((outcome) => ({ ...outcome, created: false }));
    expect(formatTranslateReport({ ...report, published })).toContain('updated PR #1');
  });
});

describe('fsReadTranslation', () => {
  it('reads valid translations only', async () => {
    const read = fsReadTranslation(dir);
    expect(read('sw', 'PS.23')).toBeNull();
    await mkdir(join(dir, 'passages/i18n/sw'), { recursive: true });
    await writeFile(join(dir, 'passages/i18n/sw/PS.23.json'), '{"not": "valid"}');
    expect(read('sw', 'PS.23')).toBeNull();
    const english = PASSAGES['PS.23'] as never;
    const translation = assembleTranslation(english, pseudoTranslation(english), {
      locale: 'sw',
      runId: 'r',
      models: ['m'],
      family: 'anthropic',
      createdAt: '2026-10-05T07:50:00Z',
      costUsd: 0,
    });
    await writeFile(join(dir, 'passages/i18n/sw/PS.23.json'), JSON.stringify(translation));
    expect(read('sw', 'PS.23')).toEqual(translation);
    expect(TRANSLATION_LABEL).toBe('translation');
  });
});
