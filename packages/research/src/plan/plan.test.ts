import { fileURLToPath } from 'node:url';

import { DEFAULT_CONFIG } from '@lectio/config';
import type { LectioConfig } from '@lectio/config';
import { openRepo } from '@lectio/content';
import { FakeGitHubClient } from '@lectio/providers';
import { describe, expect, it } from 'vitest';

import { NEEDS_REVIEW_LABEL, plan, researchBranch } from './plan.ts';
import type { PlanInput } from './plan.ts';

const FIXTURE_REPO = fileURLToPath(new URL('../fixtures/repo', import.meta.url));

/** Every passage the fixture calendar schedules from 2026-10-01 to 2026-10-07, in calendar order. */
const WINDOW_KEYS = [
  'JOB.19.21-27',
  'PS.27.7-9_27.13-14',
  'LK.10.1-12',
  'IS.55.6-9',
  'PS.139.1-3',
  'MT.18.1-5_18.10',
  'GN.2.18-24',
  'MK.10.2-16',
  'HEB.2.9-11',
  'GAL.1.13-24',
];
const MISSING = WINDOW_KEYS.filter((key) => key !== 'IS.55.6-9');

interface Options {
  readonly maxOpenReviewPrs?: number;
  readonly perRunUsd?: number;
  readonly perPassageUsd?: number;
}

function configWith(options: Options = {}): LectioConfig {
  return {
    ...DEFAULT_CONFIG,
    reviewer: { ...DEFAULT_CONFIG.reviewer, maxOpenReviewPrs: options.maxOpenReviewPrs ?? 15 },
    research: {
      ...DEFAULT_CONFIG.research,
      budget: {
        ...DEFAULT_CONFIG.research.budget,
        perRunUsd: options.perRunUsd ?? 25,
        perPassageUsd: options.perPassageUsd ?? 1.5,
      },
    },
  };
}

async function openPr(github: FakeGitHubClient, head: string, labels: readonly string[] = ['research']) {
  await github.createBranch({ name: head });
  await github.commitFiles({
    branch: head,
    message: `Work on ${head}`,
    files: [{ path: `${head}.txt`, content: 'x\n' }],
  });
  const { pr } = await github.openOrUpdatePr({ head, title: head, body: '', labels });
  return pr;
}

function setup(options: Options = {}) {
  const github = new FakeGitHubClient();
  const repo = openRepo(FIXTURE_REPO);
  const run = (overrides: Partial<PlanInput> = {}) =>
    plan({ from: '2026-10-01', days: 7, repo, github, config: configWith(options), ...overrides });
  return { github, repo, run };
}

const keys = (items: readonly { key: string }[]) => items.map((item) => item.key);

describe('plan: window and ordering', () => {
  it('lists the window passages by first date, then Mass and reading order, without existing files', async () => {
    const { run } = setup();
    const result = await run();
    expect(result.from).toBe('2026-10-01');
    expect(result.to).toBe('2026-10-07');
    expect(result.days).toBe(7);
    expect(keys(result.items)).toEqual(MISSING);
    expect(result.limitedBy).toBeNull();
    expect(result.unscheduled).toEqual([]);
  });

  it('collects every date of a key once, with the ref of its first occurrence', async () => {
    const { run } = setup();
    const { items } = await run();
    expect(items.find((item) => item.key === 'LK.10.1-12')).toEqual({
      key: 'LK.10.1-12',
      ref: 'Lk 10:1-12',
      firstDate: '2026-10-01',
      dates: ['2026-10-01', '2026-10-06'],
    });
    // The vigil and the Mass of the day share readings: one date, the vigil's ref.
    expect(items.find((item) => item.key === 'MK.10.2-16')).toEqual({
      key: 'MK.10.2-16',
      ref: 'Mk 10:2-16',
      firstDate: '2026-10-04',
      dates: ['2026-10-04'],
    });
  });

  it('reports dates without a calendar day and days whose lectionary data is missing', async () => {
    const { run } = setup();
    const result = await run();
    expect(result.missingDates).toEqual(['2026-10-05', '2026-10-07']);
    expect(result.lectionaryMissingDates).toEqual(['2026-10-03']);
  });

  it('treats a year without a calendar file as missing dates', async () => {
    const { run } = setup();
    const result = await run({ from: '2026-12-30', days: 4 });
    expect(keys(result.items)).toEqual(['JN.1.1-18']);
    expect(result.missingDates).toEqual(['2026-12-30', '2027-01-01', '2027-01-02']);
  });

  it('plans nothing for a window the calendar does not cover', async () => {
    const { run } = setup();
    const result = await run({ from: '2028-01-01', days: 2 });
    expect(result.items).toEqual([]);
    expect(result.skipped).toEqual([]);
    expect(result.budget.estimatedUsd).toBe(0);
  });
});

describe('plan: skips', () => {
  it('skips passages that already have a file', async () => {
    const { run } = setup();
    const { skipped } = await run();
    expect(skipped).toEqual([
      { key: 'IS.55.6-9', ref: 'Is 55:6-9', firstDate: '2026-10-02', dates: ['2026-10-02'], reason: 'exists' },
    ]);
  });

  it('skips passages with an open PR on research/<key>, and ignores other branches', async () => {
    const { github, run } = setup();
    const pr = await openPr(github, researchBranch('PS.139.1-3'));
    await openPr(github, 'feature/JOB.19.21-27');
    const result = await run();
    expect(keys(result.items)).toEqual(MISSING.filter((key) => key !== 'PS.139.1-3'));
    expect(result.skipped.find((item) => item.key === 'PS.139.1-3')).toMatchObject({
      reason: 'open-pr',
      pr: pr.number,
    });
  });

  it('plans a passage again once its research PR is no longer open', async () => {
    const { github, run } = setup();
    const pr = await openPr(github, researchBranch('PS.139.1-3'));
    await github.mergePr(pr.number, { matchHeadSha: pr.headSha });
    expect(keys((await run()).items)).toContain('PS.139.1-3');
  });

  it('reports an existing file before an open PR for the same key', async () => {
    const { github, run } = setup();
    await openPr(github, researchBranch('IS.55.6-9'));
    expect((await run()).skipped).toEqual([expect.objectContaining({ key: 'IS.55.6-9', reason: 'exists' })]);
  });
});

describe('plan: caps', () => {
  it('caps by reviewer capacity: maxOpenReviewPrs minus open needs-review PRs', async () => {
    const { github, run } = setup({ maxOpenReviewPrs: 3 });
    await openPr(github, 'research/OLD.1.1', ['research', NEEDS_REVIEW_LABEL]);
    await openPr(github, 'research/OTHER.1.1', ['research']);
    const result = await run();
    expect(result.capacity).toEqual({ openReviewPrs: 1, maxOpenReviewPrs: 3, available: 2 });
    expect(result.limit).toBe(2);
    expect(result.limitedBy).toBe('capacity');
    expect(keys(result.items)).toEqual(MISSING.slice(0, 2));
    const capped = result.skipped.filter((item) => item.reason === 'capacity');
    expect(keys(capped)).toEqual(MISSING.slice(2));
  });

  it('plans nothing when the review queue is already over capacity', async () => {
    const { github, run } = setup({ maxOpenReviewPrs: 1 });
    await openPr(github, 'research/A.1.1', [NEEDS_REVIEW_LABEL]);
    await openPr(github, 'research/B.1.1', [NEEDS_REVIEW_LABEL]);
    const result = await run();
    expect(result.capacity.available).toBe(0);
    expect(result.items).toEqual([]);
    expect(result.limitedBy).toBe('capacity');
  });

  it('caps by the per-run budget estimate', async () => {
    const { run } = setup({ perRunUsd: 4.5, perPassageUsd: 1.5 });
    const result = await run();
    expect(result.budget).toEqual({ perPassageUsd: 1.5, perRunUsd: 4.5, affordable: 3, estimatedUsd: 4.5 });
    expect(result.limitedBy).toBe('budget');
    expect(keys(result.items)).toEqual(MISSING.slice(0, 3));
  });

  it('counts a budget that divides exactly despite floating point', async () => {
    const { run } = setup({ perRunUsd: 0.3, perPassageUsd: 0.1 });
    expect((await run()).budget.affordable).toBe(3);
  });

  it('uses an overridden per-passage estimate; an estimate of 0 sets no budget limit', async () => {
    const { run } = setup({ perRunUsd: 1 });
    expect((await run({ perPassageUsd: 0.25 })).budget).toMatchObject({ perPassageUsd: 0.25, affordable: 4 });
    const free = await run({ perPassageUsd: 0 });
    expect(free.budget).toMatchObject({ affordable: null, estimatedUsd: 0 });
    expect(free.limit).toBe(15);
    expect(keys(free.items)).toEqual(MISSING);
  });

  it('caps by --max', async () => {
    const { run } = setup();
    const result = await run({ max: 1 });
    expect(keys(result.items)).toEqual(['JOB.19.21-27']);
    expect(result.limitedBy).toBe('max');
    expect(result.skipped.filter((item) => item.reason === 'max')).toHaveLength(MISSING.length - 1);
  });

  it('reports the earlier cap on a tie, and no cap when every candidate fits', async () => {
    const { run } = setup({ maxOpenReviewPrs: 2 });
    expect((await run({ max: 2 })).limitedBy).toBe('capacity');
    const fits = await run({ max: 20 });
    expect(fits.limit).toBe(2);
    expect(fits.limitedBy).toBe('capacity');
    const roomy = setup({ maxOpenReviewPrs: 50 });
    const all = await roomy.run({ max: 9 });
    expect(all.limit).toBe(9);
    expect(all.limitedBy).toBeNull();
    expect(all.items).toHaveLength(9);
  });

  it('does not spend capacity on skipped passages', async () => {
    const { github, run } = setup({ maxOpenReviewPrs: 2 });
    await openPr(github, researchBranch('JOB.19.21-27'));
    const result = await run();
    expect(keys(result.items)).toEqual(['PS.27.7-9_27.13-14', 'LK.10.1-12']);
  });
});

describe('plan: --only', () => {
  it('plans one key in the window', async () => {
    const { run } = setup();
    const result = await run({ only: 'LK.10.1-12' });
    expect(keys(result.items)).toEqual(['LK.10.1-12']);
    expect(result.skipped).toEqual([]);
  });

  it('uses later calendar dates for a key outside the window', async () => {
    const { run } = setup();
    const result = await run({ only: 'JN.1.1-18', days: 3 });
    expect(result.items).toEqual([
      { key: 'JN.1.1-18', ref: 'Jn 1:1-18', firstDate: '2026-12-31', dates: ['2026-12-31'] },
    ]);
  });

  it('reports a key with no calendar date from --from on as unscheduled', async () => {
    const { run } = setup();
    const before = await run({ only: 'JOB.19.21-27', from: '2026-10-02', days: 1 });
    expect(before.items).toEqual([]);
    expect(before.unscheduled).toEqual(['JOB.19.21-27']);
    expect((await run({ only: 'RV.22.1-5' })).unscheduled).toEqual(['RV.22.1-5']);
  });

  it('still skips an existing passage', async () => {
    const { run } = setup();
    const result = await run({ only: 'IS.55.6-9' });
    expect(result.items).toEqual([]);
    expect(result.skipped).toEqual([expect.objectContaining({ key: 'IS.55.6-9', reason: 'exists' })]);
  });
});

describe('plan: input validation', () => {
  it.each([
    [{ from: '2026-02-30' }, /from must be an ISO date/],
    [{ days: 0 }, /days must be a positive integer/],
    [{ days: 1.5 }, /days must be a positive integer/],
    [{ max: 0 }, /max must be a positive integer/],
    [{ max: 2.5 }, /max must be a positive integer/],
    [{ only: 'not a key' }, /only must be a passage key/],
    [{ perPassageUsd: -1 }, /perPassageUsd must be a non-negative number/],
    [{ perPassageUsd: Number.NaN }, /perPassageUsd must be a non-negative number/],
  ] as const)('rejects %o', async (overrides, message) => {
    const { run } = setup();
    await expect(run(overrides)).rejects.toThrow(message);
  });
});
