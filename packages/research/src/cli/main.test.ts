import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_CONFIG } from '@lectio/config';
import type { ContentRepo } from '@lectio/content';
import { FakeClock, FakeGitHubClient, createCostMeter, createProviders } from '@lectio/providers';
import type { CostMeter, GitHubClient, LlmClient } from '@lectio/providers';
import { afterEach, describe, expect, it } from 'vitest';

import { PASSAGES, REPO } from '../translate/fixtures/repo.ts';
import { fakeTranslateLlm } from '../translate/fixtures/fake-translation.ts';
import { USAGE } from './args.ts';
import { e2eWorld } from './fixtures/e2e.ts';
import type { E2eWorld } from './fixtures/e2e.ts';
import { DryRunError, dryRunGitHub, main, processContext } from './main.ts';
import type { CliContext } from './main.ts';
import type { Toolkit } from './providers.ts';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

function capture(): { out: string[]; err: string[]; io: { out: (l: string) => void; err: (l: string) => void } } {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, io: { out: (line) => out.push(line), err: (line) => err.push(line) } };
}

let world: E2eWorld | undefined;
let temp: string | undefined;
afterEach(() => {
  world?.cleanUp();
  world = undefined;
  if (temp !== undefined) rmSync(temp, { recursive: true, force: true });
  temp = undefined;
});

describe('main', () => {
  it('prints the usage for help, and exits 2 on a bad command line', async () => {
    world = e2eWorld();
    const help = capture();
    expect(await main(['--help'], world.context, help.io)).toBe(0);
    expect(help.out).toEqual([USAGE]);
    const bad = capture();
    expect(await main(['--bogus'], world.context, bad.io)).toBe(2);
    expect(bad.err[0]).toContain("Unknown option '--bogus'");
  });

  it('plans, and says which planned keys a person closed', async () => {
    world = e2eWorld();
    const { github } = world;
    await github.createBranch({ name: 'research/MT.20.1-16' });
    await github.commitFiles({ branch: 'research/MT.20.1-16', message: 'x', files: [{ path: 'x', content: 'x' }] });
    const { pr } = await github.openOrUpdatePr({ head: 'research/MT.20.1-16', title: 't', body: '' });
    await github.closePr(pr.number);
    const planned = capture();
    expect(await main(['plan', '--from', '2026-10-05', '--dry-run'], world.context, planned.io)).toBe(0);
    expect(planned.out[0]).toBe('Dry run: nothing is published.');
    expect(planned.out.at(-1)).toBe(`Will skip MT.20.1-16: a person closed PR #${String(pr.number)}`);

    const ran = capture();
    expect(await main(['--from', '2026-10-05', '--budget', '5'], world.context, ran.io)).toBe(0);
    expect(ran.out.join('\n')).toContain(`Skipped MT.20.1-16: a person closed PR #${String(pr.number)}`);
    expect(world.calls).toHaveLength(0);
  });

  it('exits 1 when a passage needs attention', async () => {
    world = e2eWorld();
    const ran = capture();
    // $0.05 per passage is less than one research call: the passage runs over its budget.
    const { config } = world.context;
    const budget = { ...config.research.budget, perPassageUsd: 0.05 };
    const tight = { ...world.context, config: { ...config, research: { ...config.research, budget } } };
    expect(await main(['--from', '2026-10-05', '--budget', '5'], tight, ran.io)).toBe(1);
    const text = ran.out.join('\n');
    expect(text).toContain('1 passage(s) need attention');
    expect(text).toMatch(/MT\.20\.1-16\s+over-budget\s+-\s+\$0\.\d\d\s+over budget \(passage:MT\.20\.1-16\)/u);
  });

  it('exits 1 on a refused fixup, an unreadable report or an abandoned fixup', async () => {
    world = e2eWorld();
    const { context } = world;
    expect(await main(['--from', '2026-10-05', '--budget', '5'], context, capture().io)).toBe(0);
    const refused = capture();
    expect(await main(['fixup', '--pr', '1', '--budget', '5'], context, refused.io)).toBe(1);
    expect(refused.err[0]).toContain('has no gates comment from github-actions[bot] yet');

    const unreadable = capture();
    const reading = { ...context, readFile: () => '{' };
    expect(await main(['fixup', '--pr', '1', '--report', 'g.json', '--budget', '5'], reading, unreadable.io)).toBe(1);
    expect(unreadable.err[0]).toContain('g.json: not valid JSON');

    const abandoned = capture();
    const unplaced = JSON.stringify({
      head: null,
      results: [
        {
          gate: 'verifiers',
          status: 'flag',
          items: [
            {
              ruleId: 'verifiers/claim-supported',
              severity: 'warning',
              file: 'passages/MT.20.1-16.json',
              pointer: '',
              message: 'low',
            },
          ],
          meta: {},
        },
      ],
    });
    const config = { ...context.config, research: { ...context.config.research, maxRepairs: 0 } };
    const noRepairs = { ...context, config, readFile: () => unplaced };
    expect(await main(['fixup', '--pr', '1', '--report', 'g.json', '--budget', '5'], noRepairs, abandoned.io)).toBe(1);
    expect(abandoned.out.join('\n')).toContain('Result: the repairs did not pass the gates; nothing pushed');
  });

  it('rethrows what it does not expect', async () => {
    world = e2eWorld();
    const broken: CliContext = { ...world.context, compose: () => Promise.reject(new Error('boom')) };
    await expect(main(['plan'], broken, capture().io)).rejects.toThrow('boom');
  });
});

describe('main translate', () => {
  function translateContext(llm = fakeTranslateLlm({ passages: [PASSAGES['MT.20.1-16'] as never] })) {
    temp = mkdtempSync(join(tmpdir(), 'lectio-research-translate-'));
    const clock = new FakeClock({ start: '2026-09-15T08:00:00Z' });
    const github = new FakeGitHubClient({ clock });
    const compose = (options: { ceilingUsd: number }): Promise<Toolkit> => {
      const meter = createCostMeter({ pricing: DEFAULT_CONFIG.pricing, ceilingUsd: options.ceilingUsd });
      const providers = createProviders(DEFAULT_CONFIG, {}, { clock, costMeter: meter, github });
      return Promise.resolve({
        mode: 'fake',
        github,
        llm: llm as (meter: CostMeter) => LlmClient,
        family: 'fake',
        providers,
        clock,
        meter,
      });
    };
    const context: CliContext = {
      repoRoot: temp,
      config: DEFAULT_CONFIG,
      env: {},
      clock,
      compose,
      repo: REPO as ContentRepo,
      format: (json) => Promise.resolve(json),
    };
    return { context, github };
  }
  const args = ['translate', '--locale', 'sw', '--from', '2026-09-20', '--days', '2', '--only', 'MT.20.1-16'];

  it('runs translate on fakes as a dry run: written to the cache, nothing sent to GitHub', async () => {
    const { context, github } = translateContext();
    const ran = capture();
    expect(await main([...args, '--provider', 'fake'], context, ran.io)).toBe(0);
    const text = ran.out.join('\n');
    expect(ran.out[0]).toBe('--provider fake: dry run, nothing is published.');
    expect(text).toContain('wrote passages/i18n/sw/MT.20.1-16.json');
    expect(text).toContain('not published MT.20.1-16: dry run: createBranch was not sent to GitHub');
    expect(await github.listPrs({ state: 'all' })).toHaveLength(0);
  });

  it('publishes translations when not a dry run, and exits 1 when one fails', async () => {
    const { context, github } = translateContext();
    const ran = capture();
    expect(await main([...args, '--budget', '5'], context, ran.io)).toBe(0);
    expect(ran.out.join('\n')).toContain('opened PR #1');
    expect(await github.listPrs()).toHaveLength(1);

    const failing = translateContext(fakeTranslateLlm({ fallback: { fail: 'unavailable' } }));
    const failed = capture();
    expect(await main([...args, '--budget', '5'], failing.context, failed.io)).toBe(1);
    expect(failed.out.join('\n')).toContain('failed MT.20.1-16');
  });
});

describe('dryRunGitHub', () => {
  it('passes reads through (with private fields intact) and refuses every write', async () => {
    class Client extends FakeGitHubClient {
      readonly #secret = 'kept';
      secret(): string {
        return this.#secret;
      }
    }
    const inner = new Client();
    const github = dryRunGitHub(inner) as GitHubClient & Client;
    expect(github.secret()).toBe('kept');
    expect(github.actor).toBe('lectio-bot');
    expect(await github.listPrs()).toEqual([]);
    await expect(github.createBranch({ name: 'x' })).rejects.toThrow(DryRunError);
    await expect(github.upsertIssue('m', { title: 't', body: 'b' })).rejects.toThrow(
      'dry run: upsertIssue was not sent to GitHub',
    );
  });
});

describe('processContext', () => {
  it('finds the repository and its config from INIT_CWD, else the working directory', () => {
    const fromInit = processContext({ INIT_CWD: join(REPO_ROOT, 'packages') }, '/');
    expect(fromInit.repoRoot).toBe(REPO_ROOT.replace(/\/$/, ''));
    expect(fromInit.config.research.runner).toBe('local-cli');
    expect(fromInit.env).toEqual({ INIT_CWD: join(REPO_ROOT, 'packages') });
    expect(processContext({}, REPO_ROOT).repoRoot).toBe(REPO_ROOT.replace(/\/$/, ''));
  });
});
