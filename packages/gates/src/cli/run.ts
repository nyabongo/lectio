/**
 * `lectio-gates` (npm run -w @lectio/gates gates -- <command>): logic for ./index.ts.
 *
 *     lectio-gates run [--gates schema,evidence,licence] [--base origin/main] [--head HEAD]
 *                      [--root <dir>] [--config <file>] [--json out/gates.json] [--markdown out/comment.md]
 *     lectio-gates decide --results out/gates.json [--pr pr.json] [--json out/decision.json]
 *
 * `run` exits 1 when a gate fails (a flag, which needs review, exits 0). `decide` passes the
 * results to the merge rule and exits 0 for approved-commit, human-approved and auto-merge, else 1.
 * Usage errors exit 2. Relative paths start at the directory npm was invoked from (`INIT_CWD`).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { ParseArgsOptionsConfig } from 'node:util';

import { findRepoRoot, loadConfig } from '@lectio/config';
import type { LectioConfig } from '@lectio/config';
import { createProviders } from '@lectio/providers';
import type { ProviderSet } from '@lectio/providers';
import { validateGateResult } from '@lectio/schema/gate-result';

import type { Gate } from '../core/gate.ts';
import { createContext } from '../core/gate.ts';
import { createGit, nodeGitExec } from '../core/git.ts';
import type { Git, GitExec } from '../core/git.ts';
import { renderComment } from '../core/markdown.ts';
import { formatFinding, skipReason } from '../core/result.ts';
import type { GateResult } from '../core/result.ts';
import { runGates } from '../core/runner.ts';
import type { GateReport } from '../core/runner.ts';
import { GREEN_DECISIONS, decide } from '../merge-rule/index.ts';
import type { PullRequestFacts } from '../merge-rule/index.ts';
import { GATES, ruleBookFor, selectGates } from '../registry.ts';

export const USAGE = [
  'usage: lectio-gates run [--gates <id,id,…>] [--base <ref>] [--head <ref>] [--root <dir>] [--config <file>]',
  '                        [--json <file>] [--markdown <file>]',
  '       lectio-gates decide --results <gates.json> [--pr <pr.json>] [--base <ref>] [--head <ref>] [--root <dir>]',
  '                           [--config <file>] [--json <file>]',
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
  /** Defaults to `createProviders(config, env)` (fakes unless the caller injects live ones). */
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
  return {
    root,
    git: createGit(root, options.gitExec ?? nodeGitExec),
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

async function runCommand(args: readonly string[], options: GatesCliOptions): Promise<number> {
  const { values } = parse(args, { ...COMMON, gates: { type: 'string' }, markdown: { type: 'string' } });
  const registry = options.gates ?? GATES;
  const ids =
    values.gates === undefined ? registry.map((gate) => gate.id) : values.gates.split(',').map((id) => id.trim());
  let gates: Gate[];
  try {
    gates = selectGates(ids, registry);
  } catch (error) {
    throw new UsageError((error as Error).message);
  }
  const { root, git, config, write, path } = setup(options, values);
  const context = createContext({
    root,
    base: values.base,
    head: values.head,
    config,
    providers: options.providers ?? createProviders(config, options.env),
    git,
  });
  const report = await runGates(gates, context);
  const rules = ruleBookFor(registry);
  for (const result of report.results) {
    options.log(describeResult(result));
    for (const item of result.items) options.log(formatFinding(item, rules).replace(/^/gm, '  '));
  }
  options.log(`lectio-gates: ${report.status}`);
  if (values.json !== undefined) write(path(values.json), `${JSON.stringify(report, null, 2)}\n`);
  if (values.markdown !== undefined) write(path(values.markdown), renderComment(report, { gates: registry, rules }));
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

async function decideCommand(args: readonly string[], options: GatesCliOptions): Promise<number> {
  const { values } = parse(args, { ...COMMON, results: { type: 'string' }, pr: { type: 'string' } });
  if (values.results === undefined) throw new UsageError('decide needs --results <gates.json>');
  const { git, config, read, write, path } = setup(options, values);
  const results = readResults(read(path(values.results)), values.results);
  const pr: PullRequestFacts =
    values.pr === undefined
      ? {
          files: git.changedFiles(values.base, values.head).map((file) => file.path),
          reviewEdits: [],
          approval: null,
          approvalCommit: null,
          lastContentCommitAt: null,
          fork: false,
        }
      : (JSON.parse(read(path(values.pr))) as PullRequestFacts);
  const outcome = decide({ results, config, pr });
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
