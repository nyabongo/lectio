import { DEFAULT_CONFIG } from '@lectio/config';
import type { LectioConfig } from '@lectio/config';
import type { ContentRepo } from '@lectio/content';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { e2eWorld } from '../cli/fixtures/e2e.ts';
import type { E2eWorld } from '../cli/fixtures/e2e.ts';
import { main } from '../cli/main.ts';
import type { CliContext } from '../cli/main.ts';
import type { ComposeOptions, Toolkit } from '../cli/providers.ts';
import type { RunReport, SummaryRow } from '../cli/run.ts';
import { REGISTERED_SUBCOMMANDS } from '../cli/registry.ts';
import { ProviderSetupError } from '../cli/providers.ts';
import {
  BACKFILL_USAGE,
  LEDGER_PATH,
  backfillSubcommand,
  formatBatchSummary,
  ledgerTotals,
  readLedger,
} from './index.ts';
import { estimateBackfill } from './estimate.ts';
import { REPO } from './fixtures/calendars.ts';

function capture(): { out: string[]; err: string[]; io: { out: (l: string) => void; err: (l: string) => void } } {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, io: { out: (line) => out.push(line), err: (line) => err.push(line) } };
}

let world: E2eWorld | undefined;
afterEach(() => {
  world?.cleanUp();
  world = undefined;
});

/** The e2e world (one Sunday, MT.20.1-16 on 2026-10-11) with budget overrides and a record of compose calls. */
function setUp(budget: Partial<LectioConfig['research']['budget']> = {}): {
  world: E2eWorld;
  context: CliContext;
  composed: ComposeOptions[];
} {
  world = e2eWorld();
  const { context } = world;
  const composed: ComposeOptions[] = [];
  const compose = context.compose as (options: ComposeOptions) => Promise<Toolkit>;
  const config = {
    ...context.config,
    research: { ...context.config.research, budget: { ...context.config.research.budget, ...budget } },
  };
  return {
    world,
    composed,
    context: {
      ...context,
      config,
      compose: (options) => {
        composed.push(options);
        return compose(options);
      },
    },
  };
}

describe('research backfill', () => {
  it('is registered with the CLI', () => {
    expect(REGISTERED_SUBCOMMANDS).toContain(backfillSubcommand);
    expect(backfillSubcommand).toMatchObject({ name: 'backfill', usage: BACKFILL_USAGE });
  });

  it('prints the key count and estimated cost by default, and builds no provider', async () => {
    const { context, composed, world } = setUp();
    const ran = capture();
    expect(await main(['backfill'], context, ran.io)).toBe(0);
    const text = ran.out.join('\n');
    expect(text).toContain('Back-fill estimate for 2026–2028 as of 2026-10-05');
    expect(text).toContain('Passage keys: 1 in the calendars, 0 already written, 1 to research');
    expect(text).toContain('Estimated cost: $1.50 (1 × $1.50 per passage, research.budget.perPassageUsd)');
    expect(text).toContain('No calendar for 2027, 2028');
    expect(text).toContain('  2026-10-11  MT.20.1-16  (Mt 20:1-16a)');
    expect(ran.out.at(-1)).toBe('Estimate only: nothing was generated. Pass --execute to research the next batch.');
    expect(composed).toEqual([]);
    expect(world.calls).toHaveLength(0);
  });

  it('with the ceiling at 0, --execute generates nothing, even with a budget', async () => {
    const { context, composed, world } = setUp();
    for (const argv of [['--execute'], ['--execute', '--budget', '5'], ['--execute', '--provider', 'fake']]) {
      const ran = capture();
      expect(await main(['backfill', ...argv], context, ran.io)).toBe(1);
      expect(ran.out.join('\n')).toContain('Estimated cost: $1.50');
      expect(ran.err).toEqual([
        'research backfill: research.budget.backfillTotalUsd is $0.00, so back-fill only estimates and nothing was ' +
          'generated. The owner sets the ceiling in config/lectio.config.json (docs/decisions/004-research-runner.md).',
      ]);
    }
    expect(composed).toEqual([]);
    expect(world.calls).toHaveLength(0);
    expect(await world.github.listPrs({ state: 'all' })).toHaveLength(0);
  });

  it('refuses a live batch without --budget, or above research.budget.perRunUsd', async () => {
    const { context, composed, world } = setUp({ backfillTotalUsd: 100 });
    const refused = capture();
    expect(await main(['backfill', '--execute'], context, refused.io)).toBe(1);
    expect(refused.err.join('\n')).toContain('pass --budget <usd>');
    const above = capture();
    expect(await main(['backfill', '--execute', '--budget', '30'], context, above.io)).toBe(2);
    expect(above.err.join('\n')).toContain('above research.budget.perRunUsd');
    expect(composed).toEqual([]);
    expect(world.calls).toHaveLength(0);
  });

  it('researches and publishes a batch capped by the run budget and the back-fill ceiling', async () => {
    const { context, composed, world } = setUp({ backfillTotalUsd: 3 });
    const ran = capture();
    expect(await main(['backfill', '--execute', '--budget', '5', '--max', '4'], context, ran.io)).toBe(0);
    expect(composed).toMatchObject([{ mode: 'live', ceilingUsd: 3, llm: true }]);
    const text = ran.out.join('\n');
    expect(text).toContain(
      'Back-fill ceiling: $3.00 (research.budget.backfillTotalUsd): $0.00 spent so far, $3.00 left; ' +
        'covers every remaining passage.',
    );
    expect(text).toContain(
      'Batch ceiling: $3.00 (the run budget, at most what is left of research.budget.backfillTotalUsd). ' +
        `Reserved in ${LEDGER_PATH} until the batch ends.`,
    );
    expect(text).toContain('Research plan 2026-10-05 to 2028-12-31 (819 days)');
    expect(ran.out.at(-2)).toBe('Back-fill: 1 passage(s) ready in this batch; 0 left, estimated $0.00.');
    const entries = readLedger(join(context.repoRoot, LEDGER_PATH));
    expect(entries).toMatchObject([{ reservedUsd: 3 }, { spentUsd: expect.any(Number) as number }]);
    const { spentUsd } = ledgerTotals(entries);
    expect(spentUsd).toBeGreaterThan(0);
    expect(ran.out.at(-1)).toBe(
      `Back-fill spend: $${spentUsd.toFixed(2)} in this batch; $${spentUsd.toFixed(2)} of $3.00 spent in total, ` +
        `$${(3 - spentUsd).toFixed(2)} left (${LEDGER_PATH}; commit it so other clones count it).`,
    );
    expect(await world.github.listPrs({ state: 'all' })).toHaveLength(1);
  });

  it('uses the run budget when it is below the ceiling; a dry run publishes nothing', async () => {
    const { context, composed, world } = setUp({ backfillTotalUsd: 100 });
    const ran = capture();
    expect(await main(['backfill', '--execute', '--budget', '5', '--dry-run'], context, ran.io)).toBe(0);
    expect(composed).toMatchObject([{ ceilingUsd: 5 }]);
    expect(ran.out).toContain('Dry run: nothing is published.');
    expect(ran.out.at(-2)).toBe(
      'Back-fill: 1 passage(s) ready in this batch; 0 would be left (dry run: nothing was published), estimated $0.00.',
    );
    // A live dry run still calls the model, so it is recorded.
    expect(readLedger(join(context.repoRoot, LEDGER_PATH))).toHaveLength(2);
    expect(await world.github.listPrs({ state: 'all' })).toHaveLength(0);

    const fake = capture();
    expect(await main(['backfill', '--execute', '--provider', 'fake', '--per-passage', '2'], context, fake.io)).toBe(0);
    expect(composed.at(-1)).toMatchObject({ mode: 'fake', ceilingUsd: 25 });
    expect(fake.out).toContain('--provider fake: dry run, nothing is published.');
    expect(fake.out.join('\n')).toContain('$2.00 per passage, measured average');
    expect(fake.out.join('\n')).toContain(
      `--provider fake spends nothing real: this batch is not recorded in ${LEDGER_PATH}.`,
    );
    expect(fake.out.at(-1)).toMatch(/^Back-fill: /u);
    expect(readLedger(join(context.repoRoot, LEDGER_PATH))).toHaveLength(2);
  });

  it('exits 1 when a passage of the batch needs attention', async () => {
    // $0.05 per passage is less than one research call: the passage runs over its budget.
    const { context } = setUp({ backfillTotalUsd: 100, perPassageUsd: 0.05 });
    const ran = capture();
    expect(await main(['backfill', '--execute', '--budget', '5'], context, ran.io)).toBe(1);
    expect(ran.out.join('\n')).toContain('1 passage(s) need attention');
    expect(ran.out.at(-2)).toBe('Back-fill: 0 passage(s) ready in this batch; 1 left, estimated $0.05.');
  });

  it('says when nothing is left to back-fill', async () => {
    const { context, composed } = setUp({ backfillTotalUsd: 100 });
    const ran = capture();
    const repo = context.repo as ContentRepo;
    const written = { ...context, repo: { ...repo, passageKeys: () => ['MT.20.1-16'] } };
    expect(await main(['backfill', '--execute', '--to-year', '2026'], written, ran.io)).toBe(0);
    expect(ran.out.join('\n')).toContain('Passage keys: 1 in the calendars, 1 already written, 0 to research');
    expect(ran.out.at(-1)).toBe('Nothing left to back-fill.');
    expect(composed).toEqual([]);
  });

  it('exits 2 on a bad command line', async () => {
    const { context } = setUp();
    const bad = capture();
    expect(await main(['backfill', '--bogus'], context, bad.io)).toBe(2);
    expect(bad.err[0]).toContain("Unknown option '--bogus'");
    const common = capture();
    expect(await main(['backfill', '--provider', 'cloud'], context, common.io)).toBe(2);
    expect(common.err[0]).toContain('--provider must be live or fake');
    const years = capture();
    expect(await main(['backfill', '--to-year', '9999'], context, years.io)).toBe(2);
    expect(years.err).toEqual(['--to-year 9999 has no calendar (committed calendar years: 2026–2026)']);
  });

  it('skips keys whose research PR a person closed before the batch is capped', async () => {
    const { context, world } = setUp({ backfillTotalUsd: 100 });
    const { github } = world;
    await github.createBranch({ name: 'research/MT.20.1-16' });
    await github.commitFiles({ branch: 'research/MT.20.1-16', message: 'x', files: [{ path: 'x', content: 'x' }] });
    const { pr } = await github.openOrUpdatePr({ head: 'research/MT.20.1-16', title: 't', body: '' });
    await github.closePr(pr.number);
    const ran = capture();
    expect(await main(['backfill', '--execute', '--budget', '5', '--max', '1'], context, ran.io)).toBe(0);
    const text = ran.out.join('\n');
    expect(text).toContain('To research (0, estimated $0.00)');
    expect(text).not.toContain('passage file exists');
    expect(text).toContain(`Skipped MT.20.1-16: a person closed PR #${String(pr.number)}`);
    expect(ran.out.at(-2)).toBe(
      'Back-fill: 0 passage(s) ready in this batch; 1 skipped (a person closed their PR); 0 left, estimated $0.00.',
    );
    expect(world.calls).toHaveLength(0);
  });

  it('never spends more than backfillTotalUsd over repeated batches, then refuses', async () => {
    const { context, composed } = setUp({ backfillTotalUsd: 4 });
    const ledger = join(context.repoRoot, LEDGER_PATH);
    const compose = context.compose as (options: ComposeOptions) => Promise<Toolkit>;
    // Every batch spends all it may: the worst case for the cumulative ceiling.
    const greedy: CliContext = {
      ...context,
      compose: async (options) => {
        const kit = await compose(options);
        Object.defineProperty(kit.meter, 'spentUsd', { value: () => options.ceilingUsd });
        return kit;
      },
    };
    const codes: number[] = [];
    let refusal: string[] = [];
    for (let batch = 0; batch < 10 && codes.at(-1) !== 1; batch++) {
      const ran = capture();
      // A dry run publishes nothing, so every batch researches the same key again.
      codes.push(await main(['backfill', '--execute', '--budget', '1.5', '--dry-run'], greedy, ran.io));
      refusal = ran.err;
    }
    expect(codes).toEqual([0, 0, 0, 1]);
    expect(refusal).toEqual([
      'research backfill: the back-fill ceiling is used up ($4.00 of $4.00 research.budget.backfillTotalUsd in ' +
        `${ledger}); nothing was generated. The owner raises the ceiling in config/lectio.config.json to back-fill more.`,
    ]);
    expect(composed.map((options) => options.ceilingUsd)).toEqual([1.5, 1.5, 1]);
    expect(ledgerTotals(readLedger(ledger))).toEqual({ spentUsd: 4, openRuns: 0 });

    const estimate = capture();
    expect(await main(['backfill'], context, estimate.io)).toBe(0);
    expect(estimate.out.join('\n')).toContain('$4.00 spent so far, $0.00 left; used up, nothing more is generated.');
  });

  it('records what a batch really spent, which leaves the rest for later batches', async () => {
    const { context } = setUp({ backfillTotalUsd: 4 });
    const ran = capture();
    expect(await main(['backfill', '--execute', '--budget', '2', '--dry-run'], context, ran.io)).toBe(0);
    const { spentUsd } = ledgerTotals(readLedger(join(context.repoRoot, LEDGER_PATH)));
    expect(spentUsd).toBeGreaterThan(0);
    expect(spentUsd).toBeLessThan(2);
  });

  it('caps the batch at what is left of the ceiling and shows it in the estimate', async () => {
    const { context, composed } = setUp({ backfillTotalUsd: 10 });
    const ledger = join(context.repoRoot, LEDGER_PATH);
    mkdirSync(join(context.repoRoot, 'research'), { recursive: true });
    writeFileSync(
      ledger,
      '{"run":"a","at":"2026-10-01T00:00:00Z","reservedUsd":9}\n' +
        '{"run":"a","at":"2026-10-01T01:00:00Z","spentUsd":8.5}\n',
    );
    const ran = capture();
    await main(['backfill', '--execute', '--budget', '5', '--dry-run'], context, ran.io);
    expect(ran.out.join('\n')).toContain(
      'Back-fill ceiling: $10.00 (research.budget.backfillTotalUsd): $8.50 spent so far, $1.50 left; ' +
        'covers every remaining passage.',
    );
    expect(composed).toMatchObject([{ ceilingUsd: 1.5 }]);
    expect(readLedger(ledger)[2]).toMatchObject({ reservedUsd: 1.5 });
  });

  it('refuses a fake batch once the ceiling is used up, without recording it', async () => {
    const { context, composed } = setUp({ backfillTotalUsd: 2 });
    const ledger = join(context.repoRoot, LEDGER_PATH);
    mkdirSync(join(context.repoRoot, 'research'), { recursive: true });
    writeFileSync(ledger, '{"run":"a","at":"2026-10-01T00:00:00Z","reservedUsd":2}\n');
    const ran = capture();
    expect(await main(['backfill', '--execute', '--provider', 'fake'], context, ran.io)).toBe(1);
    expect(ran.out.join('\n')).toContain('$2.00 spent so far, $0.00 left; used up, nothing more is generated.');
    expect(ran.err).toEqual([
      'research backfill: the back-fill ceiling is used up ($2.00 of $2.00 research.budget.backfillTotalUsd in ' +
        `${LEDGER_PATH}); nothing was generated.`,
    ]);
    expect(composed).toEqual([]);
    expect(readLedger(ledger)).toHaveLength(1);
  });

  it('settles $0 when the providers cannot be built, and refuses a broken ledger', async () => {
    const { context } = setUp({ backfillTotalUsd: 10 });
    const ledger = join(context.repoRoot, LEDGER_PATH);
    const failing: CliContext = {
      ...context,
      compose: () => Promise.reject(new ProviderSetupError('ANTHROPIC_API_KEY is not set')),
    };
    const ran = capture();
    expect(await main(['backfill', '--execute', '--budget', '5'], failing, ran.io)).toBe(1);
    expect(ran.err).toEqual(['ANTHROPIC_API_KEY is not set']);
    expect(ran.out.at(-1)).toContain('Back-fill spend: $0.00 in this batch; $0.00 of $10.00 spent in total');
    expect(ledgerTotals(readLedger(ledger))).toEqual({ spentUsd: 0, openRuns: 0 });

    writeFileSync(ledger, 'not json\n');
    // The estimate still prints, with spend unknown; a batch is refused.
    const estimate = capture();
    expect(await main(['backfill'], context, estimate.io)).toBe(0);
    expect(estimate.out.join('\n')).toContain(
      'Back-fill ceiling: $10.00 (research.budget.backfillTotalUsd): spent so far unknown (the spend ledger does ' +
        'not read), so what is left is unknown too.',
    );
    expect(estimate.err).toHaveLength(1);
    expect(estimate.err[0]).toMatch(/^warning: research backfill: .* line 1 is not a ledger entry/u);
    const batch = capture();
    expect(await main(['backfill', '--execute', '--budget', '5'], context, batch.io)).toBe(1);
    expect(batch.err[0]).toContain('line 1 is not a ledger entry');
    expect(batch.out).toEqual([]);
  });

  it('reports a settlement it cannot record without hiding the batch outcome or error', async () => {
    const { context } = setUp({ backfillTotalUsd: 10 });
    const ledger = join(context.repoRoot, LEDGER_PATH);
    const compose = context.compose as (options: ComposeOptions) => Promise<Toolkit>;
    // After the reservation the ledger becomes a directory, so the settlement cannot be appended.
    const breakLedger = (): void => {
      rmSync(ledger);
      mkdirSync(ledger);
    };
    const settles: CliContext = {
      ...context,
      compose: (options) => {
        breakLedger();
        return compose(options);
      },
    };
    const ran = capture();
    expect(await main(['backfill', '--execute', '--budget', '5', '--dry-run'], settles, ran.io)).toBe(0);
    expect(ran.out.at(-1)).toMatch(/^Back-fill: 1 passage\(s\) ready/u);
    expect(ran.err.at(-1)).toMatch(
      /^research backfill: could not record what run backfill-\S+ spent \(\$\d+\.\d{2}\) in research\/backfill-ledger\.jsonl: .*EISDIR.*append this line to the ledger by hand: \{"run":"backfill-[^"]+","at":"[^"]+","spentUsd":[\d.]+\}$/u,
    );

    rmSync(ledger, { recursive: true });
    const failing: CliContext = {
      ...context,
      compose: () => {
        breakLedger();
        return Promise.reject(new ProviderSetupError('ANTHROPIC_API_KEY is not set'));
      },
    };
    const both = capture();
    expect(await main(['backfill', '--execute', '--budget', '5'], failing, both.io)).toBe(1);
    expect(both.err).toHaveLength(2);
    expect(both.err[0]).toContain('could not record what run');
    expect(both.err[0]).toContain('"spentUsd":0}');
    expect(both.err[1]).toBe('ANTHROPIC_API_KEY is not set');
  });

  it('opens the repository, corpus, clock and providers itself when the context has none', async () => {
    const { context } = setUp({ backfillTotalUsd: 100 });
    const { repoRoot, config, env } = context;
    const ran = capture();
    await main(['backfill', '--execute', '--provider', 'fake'], { repoRoot, config, env }, ran.io);
    const text = ran.out.join('\n');
    expect(text).toContain('Passage keys: 1 in the calendars');
    expect(text).toMatch(/^Back-fill: \d passage\(s\) ready in this batch/mu);
  });
});

describe('formatBatchSummary', () => {
  const estimate = estimateBackfill({
    fromYear: 2026,
    toYear: 2026,
    today: '2026-10-05',
    repo: REPO,
    config: DEFAULT_CONFIG,
  });
  const row = (key: string, pr: string): SummaryRow => ({
    key,
    research: 'written',
    validation: 'ready',
    costUsd: 1,
    pr,
    problem: false,
  });

  it('counts only published passages as ready, not a skipped publish', () => {
    const report = {
      dryRun: false,
      rows: [row('JN.1.1', 'https://github.com/nyabongo/lectio/pull/1'), row('LK.1.1', 'not published: closed')],
      published: [
        { ok: true, key: 'JN.1.1' },
        { ok: false, key: 'LK.1.1', skipped: true, error: new Error('closed') },
      ],
    } as unknown as RunReport;
    expect(formatBatchSummary(estimate, report)).toBe(
      'Back-fill: 1 passage(s) ready in this batch; 2 left, estimated $3.00.',
    );
  });
});
