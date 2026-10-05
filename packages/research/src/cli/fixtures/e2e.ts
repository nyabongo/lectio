/**
 * The end-to-end fixture: a temporary git repository holding one calendar day (references and
 * link-outs only) and a link to the repository corpus, an in-memory GitHub, and an LLM double that
 * answers research with the pre-validation fixture output and repairs with a revised claim. The
 * double poses as the configured Anthropic family: the fake family is rightly rejected by gate 1, so
 * only a double that reports a live family can show a passage going all the way to a PR.
 * Commentary only, never reading text.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DEFAULT_CONFIG } from '@lectio/config';
import { GATES, allRules, renderComment } from '@lectio/gates';
import type { GateReport } from '@lectio/gates';
import { openRepo } from '@lectio/content';
import { openCorpus } from '@lectio/corpus';
import {
  FakeClock,
  FakeGitHubClient,
  FakeLlmClient,
  MemorySourceFetcher,
  createCostMeter,
  createProviders,
} from '@lectio/providers';
import type { CostMeter, FakeLlmScriptEntry, LlmClient, LlmRequest, LlmResponse } from '@lectio/providers';

import { PAGES, REPO_ROOT, VALID_OUTPUT, validOutput } from '../../validate/fixtures/draft.ts';
import type { CliContext } from '../main.ts';
import type { Toolkit } from '../providers.ts';

export const KEY = 'MT.20.1-16';
export const PATH = `passages/${KEY}.json`;
export const REVISED_C2 = 'In Hebrew idiom an evil eye stood for a grudging spirit.';

/** One Sunday (25th in Ordinary Time, Year A), references and link-outs only. */
export const CALENDAR = {
  year: 2026,
  region: 'kenya',
  generatedBy: 'research e2e test',
  days: [
    {
      date: '2026-10-11',
      season: 'ordinary-time',
      seasonWeek: 28,
      sundayCycle: 'A',
      weekdayCycle: 'II',
      celebrations: [{ id: 'ot-28', name: '28th Sunday in Ordinary Time', rank: 'sunday', colour: 'green' }],
      masses: [
        {
          id: 'day',
          label: 'Mass of the day',
          readings: [
            { slot: 'gospel', ref: 'Mt 20:1-16a', key: KEY, linkout: 'https://www.drbo.org/chapter/47020.htm' },
          ],
        },
      ],
      lectionaryMissing: false,
    },
  ],
};

/**
 * The content-gates comment as #209 posts it: the rendered gates, then the head the run checked as
 * visible text and as a hidden marker.
 */
export function gatesCommentBody(report: GateReport, maxLength?: number): string {
  const options = { gates: GATES, rules: allRules() };
  const gates = renderComment(report, maxLength === undefined ? options : { ...options, maxLength });
  return `${gates.trimEnd()}\n\nChecked head: \`${report.head}\` <!-- lectio-gates-head: ${report.head} -->\n`;
}

/** The research output after the repair: claim c2 reworded. */
export function revisedOutput(): Record<string, unknown> {
  const output = validOutput();
  output['claims'][1].text = REVISED_C2;
  return output;
}

/** The default repair answer: the revised output. */
export const REPAIR: FakeLlmScriptEntry = {
  output: revisedOutput(),
  usage: { inputTokens: 10_000, outputTokens: 4_000 },
};

/** The fake LLM, reporting the Anthropic family; every call is recorded. */
export class PosingLlm implements LlmClient {
  readonly family = 'anthropic' as const;
  readonly #fake: FakeLlmClient;
  readonly #log: LlmRequest[];

  constructor(meter: CostMeter, log: LlmRequest[], repair: FakeLlmScriptEntry = REPAIR) {
    this.#fake = new FakeLlmClient({
      costMeter: meter,
      roles: { generator: { output: VALID_OUTPUT, usage: { inputTokens: 40_000, outputTokens: 6_000 } }, repair },
    });
    this.#log = log;
  }

  async generate(request: LlmRequest): Promise<LlmResponse> {
    this.#log.push(request);
    return { ...(await this.#fake.generate(request)), family: this.family };
  }
}

export interface E2eWorld {
  readonly root: string;
  readonly github: FakeGitHubClient;
  readonly clock: FakeClock;
  readonly calls: LlmRequest[];
  /** The CLI context (`compose` hands out the fakes whatever `--provider` says). */
  readonly context: CliContext;
  readonly git: (...args: string[]) => string;
  readonly cleanUp: () => void;
}

/** The temporary content repository (a git checkout on `main`) a world reads. */
export interface E2eCheckout {
  readonly root: string;
  readonly git: (...args: string[]) => string;
  readonly cleanUp: () => void;
}

/** A fresh temporary content repository: one calendar day, an empty `passages/` and the corpus link. */
export function e2eCheckout(): E2eCheckout {
  const root = mkdtempSync(join(tmpdir(), 'lectio-research-e2e-'));
  const git = (...args: string[]): string => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  mkdirSync(join(root, 'calendar'));
  mkdirSync(join(root, 'passages'));
  writeFileSync(join(root, 'calendar', '2026.json'), `${JSON.stringify(CALENDAR, null, 2)}\n`);
  writeFileSync(join(root, 'passages', '.gitkeep'), '');
  symlinkSync(join(REPO_ROOT, 'corpus'), join(root, 'corpus'), 'dir');
  git('init', '--quiet', '--initial-branch=main');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'user.name', 'Test');
  git('config', 'commit.gpgsign', 'false');
  git('add', 'calendar', 'passages');
  git('commit', '--quiet', '-m', 'calendar');
  return { root, git, cleanUp: () => rmSync(root, { recursive: true, force: true }) };
}

/**
 * A fresh world: new fakes around a content repository. Without `checkout` it makes its own and
 * `cleanUp` removes it. With one (shared by a test file, which must not change it) the world only
 * reads it, and `cleanUp` leaves it to its owner.
 */
export function e2eWorld(
  options: { readonly repair?: FakeLlmScriptEntry; readonly checkout?: E2eCheckout } = {},
): E2eWorld {
  const checkout = options.checkout ?? e2eCheckout();
  const { root, git } = checkout;
  const clock = new FakeClock({ start: '2026-10-05T07:50:00.000Z' });
  const github = new FakeGitHubClient({ clock, actor: 'nyabongo' });
  const calls: LlmRequest[] = [];
  const config = DEFAULT_CONFIG;
  const compose = (wanted: { ceilingUsd: number }): Promise<Toolkit> => {
    const meter = createCostMeter({ pricing: config.pricing, ceilingUsd: wanted.ceilingUsd, label: 'research-run' });
    const llm = (child: CostMeter): LlmClient => new PosingLlm(child, calls, options.repair);
    const providers = createProviders(
      config,
      {},
      {
        clock,
        costMeter: meter,
        github,
        fetcher: new MemorySourceFetcher(PAGES, clock),
      },
    );
    return Promise.resolve({ mode: 'live', github, llm, family: 'anthropic', providers, clock, meter });
  };
  const context: CliContext = {
    repoRoot: root,
    config,
    env: {},
    clock,
    compose,
    repo: openRepo(root),
    corpus: openCorpus(join(root, 'corpus')),
    files: {
      head: (pr, path) => Promise.resolve(github.fileAt(pr.headSha, path) ?? null),
      base: (pr, path) => {
        const listed = git('ls-tree', '--name-only', pr.base, '--', path);
        return Promise.resolve(listed.trim() === '' ? null : git('show', `${pr.base}:${path}`));
      },
    },
    format: (json) => Promise.resolve(json),
  };
  const cleanUp = options.checkout === undefined ? checkout.cleanUp : () => undefined;
  return { root, github, clock, calls, context, git, cleanUp };
}
