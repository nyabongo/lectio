import type { LectioConfig } from '@lectio/config';
import { afterEach, describe, expect, it } from 'vitest';

import { e2eWorld } from '../cli/fixtures/e2e.ts';
import type { E2eWorld } from '../cli/fixtures/e2e.ts';
import { main } from '../cli/main.ts';
import type { CliContext } from '../cli/main.ts';
import type { ComposeOptions, Toolkit } from '../cli/providers.ts';
import { REGISTERED_SUBCOMMANDS } from '../cli/registry.ts';
import { BACKFILL_USAGE, backfillSubcommand } from './index.ts';

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
      'Back-fill ceiling: $3.00 (research.budget.backfillTotalUsd): covers every remaining passage.',
    );
    expect(text).toContain('Batch ceiling: $3.00 (the run budget, at most research.budget.backfillTotalUsd).');
    expect(text).toContain('Research plan 2026-10-05 to 2028-12-31 (819 days)');
    expect(ran.out.at(-1)).toBe('Back-fill: 1 passage(s) ready in this batch; 0 left, estimated $0.00.');
    expect(await world.github.listPrs({ state: 'all' })).toHaveLength(1);
  });

  it('uses the run budget when it is below the ceiling; a dry run publishes nothing', async () => {
    const { context, composed, world } = setUp({ backfillTotalUsd: 100 });
    const ran = capture();
    expect(await main(['backfill', '--execute', '--budget', '5', '--dry-run'], context, ran.io)).toBe(0);
    expect(composed).toMatchObject([{ ceilingUsd: 5 }]);
    expect(ran.out).toContain('Dry run: nothing is published.');
    expect(ran.out.at(-1)).toBe(
      'Back-fill: 1 passage(s) ready in this batch; 0 would be left (dry run: nothing was published), estimated $0.00.',
    );
    expect(await world.github.listPrs({ state: 'all' })).toHaveLength(0);

    const fake = capture();
    expect(await main(['backfill', '--execute', '--provider', 'fake', '--per-passage', '2'], context, fake.io)).toBe(0);
    expect(composed.at(-1)).toMatchObject({ mode: 'fake', ceilingUsd: 25 });
    expect(fake.out).toContain('--provider fake: dry run, nothing is published.');
    expect(fake.out.join('\n')).toContain('$2.00 per passage, measured average');
  });

  it('exits 1 when a passage of the batch needs attention', async () => {
    // $0.05 per passage is less than one research call: the passage runs over its budget.
    const { context } = setUp({ backfillTotalUsd: 100, perPassageUsd: 0.05 });
    const ran = capture();
    expect(await main(['backfill', '--execute', '--budget', '5'], context, ran.io)).toBe(1);
    expect(ran.out.join('\n')).toContain('1 passage(s) need attention');
    expect(ran.out.at(-1)).toBe('Back-fill: 0 passage(s) ready in this batch; 1 left, estimated $0.05.');
  });

  it('says when nothing is left to back-fill', async () => {
    const { context, composed } = setUp({ backfillTotalUsd: 100 });
    const ran = capture();
    expect(await main(['backfill', '--execute', '--from-year', '2027', '--to-year', '2027'], context, ran.io)).toBe(0);
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
