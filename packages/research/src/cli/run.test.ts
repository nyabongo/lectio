import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { FakeLlmClient } from '@lectio/providers';
import type { CostMeter, FakeLlmScriptEntry, LlmClient, PullRequest } from '@lectio/providers';
import { afterEach, describe, expect, it } from 'vitest';

import type { PassageResult, ResearchRunResult } from '../agent/research.ts';
import type { Plan, WorkItem } from '../plan/plan.ts';
import type { ValidationRunReport } from '../validate/validate.ts';
import { KEY, e2eWorld } from './fixtures/e2e.ts';
import type { E2eWorld } from './fixtures/e2e.ts';
import type { ComposeOptions, Toolkit } from './providers.ts';
import { checkoutReader, closedKeys, runResearch } from './run.ts';
import type { RunDeps, RunReport } from './run.ts';
import { formatRunReport, formatSummary, table } from './summary.ts';

const WINDOW = { from: '2026-10-05', days: 14 } as const;

let world: E2eWorld | undefined;
afterEach(() => {
  world?.cleanUp();
  world = undefined;
});

async function deps(w: E2eWorld, extra: Partial<RunDeps> = {}, ceilingUsd = 10): Promise<RunDeps> {
  const compose = w.context.compose as (options: ComposeOptions) => Promise<Toolkit>;
  const kit = await compose({ mode: 'live', config: w.context.config, env: {}, ceilingUsd, llm: true });
  return {
    ...kit,
    config: w.context.config,
    repoRoot: w.root,
    repo: w.context.repo as RunDeps['repo'],
    corpus: w.context.corpus as RunDeps['corpus'],
    dryRun: false,
    format: (json) => Promise.resolve(json),
    ...extra,
  };
}

/** An LLM that answers the generator with `generator` and reports the Anthropic family. */
function posing(generator: FakeLlmScriptEntry): (meter: CostMeter) => LlmClient {
  return (meter) => {
    const fake = new FakeLlmClient({ costMeter: meter, roles: { generator, repair: generator } });
    return {
      family: 'anthropic',
      generate: async (request) => ({ ...(await fake.generate(request)), family: 'anthropic' }),
    };
  };
}

describe('runResearch', () => {
  it('keeps raw drafts in the git-ignored cache by default and publishes on the base given', async () => {
    world = e2eWorld();
    const report = await runResearch(WINDOW, await deps(world, { base: 'main' }));
    expect(existsSync(join(world.root, '.cache', 'research', report.runId, 'passages', `${KEY}.json`))).toBe(true);
    expect(report.rows).toEqual([
      expect.objectContaining({ key: KEY, research: 'written', validation: 'ready', problem: false }),
    ]);
    expect(report.rows[0]?.pr).toMatch(/^https:\/\//u);
    expect(report.ceilingUsd).toBe(10);
    expect(report.spentUsd).toBeGreaterThan(0);
  });

  it('marks a dry run, and a failure with nothing to repair', async () => {
    world = e2eWorld();
    const dry = await runResearch(WINDOW, await deps(world, { dryRun: true }));
    expect(dry.rows[0]).toMatchObject({ pr: 'dry run', problem: false });
    expect(dry.published).toEqual([]);
    expect(formatSummary(dry)).toContain('(dry run: nothing was published)');

    const failed = await runResearch(WINDOW, await deps(world, { llm: posing({ fail: 'unavailable' }) }));
    expect(failed.rows[0]).toMatchObject({ research: 'failed', pr: 'nothing to repair', problem: true });
  });

  it('abandons a draft that cannot pass, and reports a publish refusal', async () => {
    world = e2eWorld();
    const abandoned = await runResearch(WINDOW, await deps(world, { llm: posing({ text: '{"oops' }) }));
    expect(abandoned.rows[0]).toMatchObject({
      research: 'failed',
      validation: 'abandoned',
      pr: 'abandoned',
      problem: true,
    });

    // A leftover research branch without a PR: publishing refuses it.
    await world.github.createBranch({ name: `research/${KEY}` });
    const refused = await runResearch(WINDOW, await deps(world));
    expect(refused.rows[0]).toMatchObject({ validation: 'ready', problem: true });
    expect(refused.rows[0]?.pr).toContain('not published: branch research/MT.20.1-16 exists without an open PR');
  });

  it('notes passages the run budget never reached', async () => {
    world = e2eWorld();
    // The whole run budget is gone before the run starts: the planned passage never starts.
    const d = await deps(world, {}, 10);
    d.meter.chargeUsd(10, 'earlier');
    const report = await runResearch(WINDOW, d);
    expect(report.research.notStarted).toEqual([KEY]);
    expect(report.rows).toEqual([
      { key: KEY, research: 'not-started', costUsd: 0, pr: 'run budget spent', problem: true },
    ]);
  });
});

describe('closedKeys', () => {
  const item = (key: string): WorkItem => ({ key, ref: key, firstDate: '2026-10-11', dates: ['2026-10-11'] });
  const pr = (number: number, head: string, state: PullRequest['state'], fork = false): PullRequest =>
    ({ number, head, state, fork }) as PullRequest;

  it('lists keys whose research PR was closed and has no open successor; forks never count', async () => {
    const prs = [
      pr(1, 'research/A.1.1', 'closed'),
      pr(2, 'research/B.1.1', 'closed'),
      pr(3, 'research/B.1.1', 'open'),
      pr(4, 'research/C.1.1', 'closed', true),
      pr(5, 'research/D.1.1', 'merged'),
    ];
    const github = { listPrs: () => Promise.resolve(prs) };
    expect(await closedKeys(['A.1.1', 'B.1.1', 'C.1.1', 'D.1.1'].map(item), github)).toEqual([{ key: 'A.1.1', pr: 1 }]);
  });

  it('does not ask GitHub when nothing is planned', async () => {
    const github = { listPrs: () => Promise.reject(new Error('not called')) };
    expect(await closedKeys([], github)).toEqual([]);
  });
});

describe('checkoutReader', () => {
  it('reads a file of the checkout, or null', () => {
    world = e2eWorld();
    mkdirSync(join(world.root, 'passages'), { recursive: true });
    writeFileSync(join(world.root, 'passages', 'A.1.1.json'), '{}');
    const read = checkoutReader(world.root);
    expect(read('passages/A.1.1.json')).toBe('{}');
    expect(read('passages/B.1.1.json')).toBeNull();
  });
});

describe('summary', () => {
  const empty: RunReport = {
    runId: 'research-x',
    plan: {
      from: '2026-10-05',
      to: '2026-10-05',
      days: 1,
      items: [],
      skipped: [],
      unscheduled: [],
      missingDates: [],
      lectionaryMissingDates: [],
      capacity: { openReviewPrs: 0, maxOpenReviewPrs: 15, available: 15 },
      weekly: { openedLast7Days: 0, weeklyCapacity: 15, available: 15 },
      budget: { perPassageUsd: 1.5, perRunUsd: 5, affordable: 3, estimatedUsd: 0 },
      limit: 3,
      limitedBy: null,
    } satisfies Plan,
    closed: [],
    research: { results: [] as PassageResult[], notStarted: [], spentUsd: 0 } satisfies ResearchRunResult,
    validation: {
      results: [],
      ready: [],
      readyWithDrops: [],
      abandoned: [],
      repairPromptVersion: 'repair-v1',
    } satisfies ValidationRunReport,
    published: [],
    dryRun: false,
    ceilingUsd: 5,
    spentUsd: 0,
    rows: [],
  };

  it('says when there was nothing to research', () => {
    expect(formatSummary(empty)).toBe('Run research-x\nNothing to research.\nSpent $0.00 of the $5.00 run budget.');
    expect(formatRunReport(empty)).toContain('Research plan 2026-10-05 to 2026-10-05');
  });

  it('aligns table columns', () => {
    expect(table(['A', 'Long'], [['xyz', 'b'], ['q']])).toBe('A    Long\n---  ----\nxyz  b\nq');
  });
});
