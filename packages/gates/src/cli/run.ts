/**
 * `lectio-gates` (npm run -w @lectio/gates gates -- <command>): logic for ./index.ts.
 *
 *     lectio-gates run [--gates schema,evidence,licence] [--base origin/main] [--head HEAD]
 *                      [--root <dir>] [--config <file>] [--json out/gates.json] [--markdown out/comment.md]
 *                      [--fetch fixtures|live] [--llm off|live]
 *     lectio-gates decide --results out/gates.json [--pr pr.json | --pr-number <n>] [--json out/decision.json]
 *     lectio-gates ci resolve|changes|merge-rule|merge …   (content-gates.yml; see ../ci/cli.ts)
 *
 * The changed files are `git diff <base>...<head>`, committed changes only: a file edited but not
 * committed is not checked (the verifier gate then reports no passage files changed relative to
 * `--base`). `run` reads files from the working tree at `--root`, so `--head` must be the commit checked out
 * there (it is refused otherwise). `--pr` is a JSON file of `PullRequestFacts` (core/pull-request.ts);
 * without it the facts come from the git diff (renames and review blocks set to approved included),
 * with PR number `--pr-number`, a positive integer (omitted: PR 0, a local run). `decide` reads the changed passages from
 * the working tree, so `--head` must be checked out there too.
 *
 * `--fetch live` injects the live source fetcher (`@lectio/provider-fetch`, SSRF guard on); the
 * default `fixtures` keeps the offline fake, and the log and the comment then say so. `--llm live`
 * injects the live verifier clients whose API keys are set (`../ci/providers.ts`). Only
 * content-gates.yml passes either; ci.yml and local runs stay offline.
 *
 * `run` exits 1 when a gate fails (a flag, which needs review, exits 0). `decide` passes the
 * results to the merge rule and exits 0 for approved-commit, human-approved and auto-merge, else 1.
 * Usage errors exit 2. Relative paths start at the directory npm was invoked from (`INIT_CWD`).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { ParseArgsOptionsConfig } from 'node:util';

import { findRepoRoot, loadConfig } from '@lectio/config';
import type { LectioConfig } from '@lectio/config';
import type { ProviderSet } from '@lectio/providers';
import { validateGateResult } from '@lectio/schema/gate-result';

import type { Gate } from '../core/gate.ts';
import { createContext, noFollowReadText, nodeReadText } from '../core/gate.ts';
import { checkedOutAt, createGit, nodeGitExec, nonRegularFiles } from '../core/git.ts';
import type { ChangedFile, Git, GitExec } from '../core/git.ts';
import { renderComment } from '../core/markdown.ts';
import { formatFinding, skipReason } from '../core/result.ts';
import type { GateResult } from '../core/result.ts';
import { REPORT_VERSION, nonRegularResult, runGates } from '../core/runner.ts';
import type { GateReport } from '../core/runner.ts';
import { parsePullRequestFacts } from '../core/pull-request.ts';
import type { PullRequestFacts } from '../core/pull-request.ts';
import { GREEN_DECISIONS, changedClaims, decide, factsFromChanges } from '../merge-rule/index.ts';
import { GATES, ruleBookFor, selectGates } from '../registry.ts';
import { runCiCli } from '../ci/cli.ts';
import { FETCH_MODES, LLM_MODES, fetcherNote, gateProviders } from '../ci/providers.ts';
import type { FetchMode, LlmMode } from '../ci/providers.ts';

export const USAGE = [
  'usage: lectio-gates run [--gates <id,id,…>] [--base <ref>] [--head <ref>] [--root <dir>] [--config <file>]',
  '                        [--json <file>] [--markdown <file>] [--fetch fixtures|live] [--llm off|live]',
  '       lectio-gates decide --results <gates.json> [--pr <pr.json>] [--base <ref>] [--head <ref>] [--root <dir>]',
  '                           [--pr-number <n>] [--config <file>] [--json <file>]',
  '',
  'The changed files are `git diff <base>...<head>` (default origin/main...HEAD), so commits only: commit',
  'your changes first. A file edited but not committed is not checked, and a gate may report no changed files.',
].join('\n');

export interface GatesCliOptions {
  /** Where npm was invoked (`INIT_CWD`); relative paths start here. */
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly log: (line: string) => void;
  readonly error: (line: string) => void;
  /** The gate registry; defaults to the five gates. */
  readonly gates?: readonly Gate[];
  readonly gitExec?: GitExec;
  /** Defaults to `loadConfig(--config)`. */
  readonly config?: LectioConfig;
  /** Defaults to `gateProviders(config, env, { fetch, llm })` (fakes unless `--fetch live` / `--llm live`). */
  readonly providers?: ProviderSet;
  readonly readFile?: (path: string) => string;
  readonly writeFile?: (path: string, text: string) => void;
}

class UsageError extends Error {}

const COMMON = {
  base: { type: 'string', default: 'origin/main' },
  head: { type: 'string', default: 'HEAD' },
  root: { type: 'string' },
  config: { type: 'string' },
  json: { type: 'string' },
} as const;

function parse<T extends ParseArgsOptionsConfig>(args: readonly string[], options: T) {
  try {
    return parseArgs({ args: [...args], options, strict: true, allowPositionals: false });
  } catch (error) {
    throw new UsageError((error as Error).message);
  }
}

function writeText(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, 'utf8');
}

interface Setup {
  readonly root: string;
  readonly exec: GitExec;
  readonly git: Git;
  readonly config: LectioConfig;
  readonly write: (path: string, text: string) => void;
  readonly read: (path: string) => string;
  readonly path: (path: string) => string;
}

function setup(options: GatesCliOptions, values: { root?: string; config?: string }): Setup {
  const path = (file: string): string => resolve(options.cwd, file);
  const config = options.config ?? loadConfig(values.config, { cwd: options.cwd, env: options.env });
  const root = values.root === undefined ? findRepoRoot(options.cwd) : path(values.root);
  const exec = options.gitExec ?? nodeGitExec;
  return {
    root,
    exec,
    git: createGit(root, exec),
    config,
    path,
    write: options.writeFile ?? writeText,
    read: options.readFile ?? ((file) => readFileSync(file, 'utf8')),
  };
}

function describeResult(result: GateResult): string {
  const reason = skipReason(result);
  const findings = result.items.length === 0 ? '' : ` (${String(result.items.length)} findings)`;
  return `${result.gate}: ${result.status}${reason === undefined ? findings : ` (${reason})`}`;
}

function oneOf<T extends string>(flag: string, value: string, modes: readonly T[]): T {
  if (!(modes as readonly string[]).includes(value))
    throw new UsageError(`--${flag} must be one of ${modes.join(', ')} (got "${value}")`);
  return value as T;
}

/** The comment with `note` as a quote under its headline. */
function withNote(comment: string, note: string): string {
  const lines = comment.split('\n');
  const headline = lines.findIndex((line) => line.startsWith('## '));
  lines.splice(headline + 1, 0, '', `> ${note}`);
  return lines.join('\n');
}

async function runCommand(args: readonly string[], options: GatesCliOptions): Promise<number> {
  const { values } = parse(args, {
    ...COMMON,
    gates: { type: 'string' },
    markdown: { type: 'string' },
    fetch: { type: 'string', default: 'fixtures' },
    llm: { type: 'string', default: 'off' },
  });
  const fetch: FetchMode = oneOf('fetch', values.fetch, FETCH_MODES);
  const llm: LlmMode = oneOf('llm', values.llm, LLM_MODES);
  const registry = options.gates ?? GATES;
  const ids =
    values.gates === undefined ? registry.map((gate) => gate.id) : values.gates.split(',').map((id) => id.trim());
  let gates: Gate[];
  try {
    gates = selectGates(ids, registry);
  } catch (error) {
    throw new UsageError((error as Error).message);
  }
  const { root, exec, git, config, write, path } = setup(options, values);
  // Gates read files from the working tree at --root, so --head must be what is checked out there.
  if (!checkedOutAt(exec, root, values.head)) {
    throw new UsageError(`--head ${values.head} is not the commit checked out at ${root}; check it out first`);
  }
  const providers = options.providers ?? gateProviders(config, options.env, { fetch, llm });
  // Symbolic links and submodules are refused before any gate reads the tree, and the gates read
  // files without following links: a link in a PR could point anywhere on the runner.
  const unsafe = nonRegularFiles(exec, root, values.base, values.head);
  const report: GateReport =
    unsafe.length > 0
      ? {
          reportVersion: REPORT_VERSION,
          status: 'fail',
          base: values.base,
          head: values.head,
          changedFiles: unsafe,
          results: [nonRegularResult(unsafe)],
        }
      : await runGates(
          gates,
          createContext({
            root,
            base: values.base,
            head: values.head,
            config,
            providers,
            git,
            readText: noFollowReadText(root),
          }),
        );
  const offline = providers.fakes.has('fetcher');
  const note = fetcherNote(providers);
  const rules = ruleBookFor(registry);
  for (const result of report.results) {
    options.log(describeResult(result));
    for (const item of result.items) options.log(formatFinding(item, rules).replace(/^/gm, '  '));
  }
  options.log(`lectio-gates: ${note}`);
  options.log(`lectio-gates: ${report.status}`);
  const fetcher = offline ? 'offline-fake' : 'live';
  if (values.json !== undefined) write(path(values.json), `${JSON.stringify({ ...report, fetcher }, null, 2)}\n`);
  if (values.markdown !== undefined) {
    const comment = renderComment(report, { gates: registry, rules });
    write(path(values.markdown), offline ? withNote(comment, note) : comment);
  }
  return report.status === 'fail' ? 1 : 0;
}

function readResults(text: string, file: string): GateResult[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new UsageError(`${file}: not valid JSON (${(error as Error).message})`);
  }
  const results = (parsed as Partial<GateReport> | null)?.results;
  if (!Array.isArray(results)) throw new UsageError(`${file}: expected a gate report with a "results" array`);
  return results.map((result: unknown, index) => {
    if (!validateGateResult(result))
      throw new UsageError(`${file}: results/${String(index)} is not a valid gate result`);
    return result;
  });
}

function readPullRequestFacts(text: string, file: string): PullRequestFacts {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new UsageError(`${file}: not valid JSON (${(error as Error).message})`);
  }
  try {
    return parsePullRequestFacts(parsed);
  } catch (error) {
    throw new UsageError(`${file}: ${(error as Error).message}`);
  }
}

/** `--pr-number`: a positive integer, as in a facts file (omit it for a local run, PR 0). */
function parsePrNumber(text: string): number {
  const value = Number(text);
  if (!/^[1-9][0-9]*$/.test(text) || !Number.isSafeInteger(value)) {
    throw new UsageError(`--pr-number must be a positive integer, got "${text}"`);
  }
  return value;
}

async function decideCommand(args: readonly string[], options: GatesCliOptions): Promise<number> {
  const { values } = parse(args, {
    ...COMMON,
    results: { type: 'string' },
    pr: { type: 'string' },
    'pr-number': { type: 'string' },
  });
  if (values.results === undefined) throw new UsageError('decide needs --results <gates.json>');
  const prNumber = values['pr-number'] === undefined ? 0 : parsePrNumber(values['pr-number']);
  const { root, exec, git, config, read, write, path } = setup(options, values);
  const results = readResults(read(path(values.results)), values.results);
  // The merge rule reads the changed passages (claims, review blocks) from the working tree.
  if (!checkedOutAt(exec, root, values.head)) {
    throw new UsageError(`--head ${values.head} is not the commit checked out at ${root}; check it out first`);
  }
  const readFile = (file: string): string | null => nodeReadText(join(root, file));
  let pr: PullRequestFacts;
  let changedFiles: readonly ChangedFile[];
  if (values.pr === undefined) {
    changedFiles = git.changedFiles(values.base, values.head);
    const view = { changedFiles, readFile, readBase: (file: string) => git.show(values.base, file) };
    pr = factsFromChanges(view, prNumber);
  } else {
    pr = readPullRequestFacts(read(path(values.pr)), values.pr);
    changedFiles = pr.files.map((file): ChangedFile => ({ path: file, status: 'modified' }));
  }
  const outcome = decide({ results, config, pr, claims: changedClaims({ changedFiles, readFile }) });
  options.log(`decision: ${outcome.decision}`);
  for (const reason of outcome.reasons) options.log(`  - ${reason}`);
  if (values.json !== undefined) write(path(values.json), `${JSON.stringify(outcome, null, 2)}\n`);
  return GREEN_DECISIONS.has(outcome.decision) ? 0 : 1;
}

/** Runs `lectio-gates <command> …` and returns the exit code. */
export async function runGatesCli(argv: readonly string[], options: GatesCliOptions): Promise<number> {
  const [command, ...rest] = argv.filter((arg, index) => !(index === 0 && arg === '--'));
  try {
    if (command === 'run') return await runCommand(rest, options);
    if (command === 'decide') return await decideCommand(rest, options);
    if (command === 'ci') return await runCiCli(rest, options);
    if (command === undefined || command === 'help' || command === '--help' || command === '-h') {
      options.log(USAGE);
      return command === undefined ? 2 : 0;
    }
    throw new UsageError(`unknown command "${command}"`);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    options.error(`lectio-gates: ${error.message}`);
    options.error(USAGE);
    return 2;
  }
}
