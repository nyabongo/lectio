/**
 * The logic behind `npm run runway` (cli.ts only wires in process state).
 *
 * `runway [-- --from YYYY-MM-DD] [--dry-run]`: checks `runway.windowDays` days from today in
 * `site.timezone` (or `--from`) and upserts the runway issue. `--dry-run` prints the report
 * without touching GitHub.
 */
import { resolve } from 'node:path';

import { findRepoRoot, loadConfig } from '@lectio/config';
import type { LectioConfig } from '@lectio/config';
import { openRepo } from '@lectio/content';
import type { ContentRepo } from '@lectio/content';
import { GhGitHubClient } from '@lectio/provider-gh';
import type { GitHubClient } from '@lectio/providers';
import { isIsoDate, toIsoDateInZone } from '@lectio/shared';
import type { IsoDate } from '@lectio/shared';

import { renderIssue, runMonitor } from './monitor.ts';
import { computeRunway, isExceeded } from './runway.ts';
import type { RunwayReport } from './runway.ts';

export interface CliIo {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

export interface CliContext {
  readonly config: Pick<LectioConfig, 'runway' | 'site'>;
  readonly repo: ContentRepo;
  readonly now: () => Date;
  /** Built only when the run writes to GitHub. */
  readonly github: () => GitHubClient;
}

export interface CliArgs {
  readonly from?: IsoDate;
  readonly dryRun: boolean;
}

export const USAGE = 'usage: runway [-- [--from YYYY-MM-DD] [--dry-run]]';

/** Parses `[--from YYYY-MM-DD] [--dry-run]`; returns an error message on bad input. */
export function parseArgs(args: readonly string[]): CliArgs | string {
  let from: IsoDate | undefined;
  let dryRun = false;
  for (let i = 0; i < args.length; i += 1) {
    const flag = args[i];
    const value = args[i + 1];
    if (flag === '--dry-run' && !dryRun) {
      dryRun = true;
    } else if (flag === '--from' && from === undefined && isIsoDate(value)) {
      from = value;
      i += 1;
    } else {
      return `unexpected argument ${JSON.stringify(flag)}`;
    }
  }
  return from === undefined ? { dryRun } : { from, dryRun };
}

/**
 * The context of a real run: config and repository root found from `INIT_CWD` (else `cwd`), the
 * content repository at `content.root`, and a gh-backed client. Under GitHub Actions the client
 * acts as `github-actions[bot]` on `GITHUB_REPOSITORY`.
 */
export function processContext(env: NodeJS.ProcessEnv, cwd: string): CliContext {
  const start = env['INIT_CWD'] ?? cwd;
  const config = loadConfig(undefined, { env, cwd: start });
  const actions = env['GITHUB_ACTIONS'] === 'true';
  const repoName = env['GITHUB_REPOSITORY'];
  return {
    config,
    repo: openRepo(resolve(findRepoRoot(start), config.content.root)),
    now: () => new Date(),
    github: () =>
      new GhGitHubClient({
        env,
        ...(actions ? { viewer: 'github-actions[bot]' } : {}),
        ...(repoName !== undefined && repoName !== '' ? { repo: repoName } : {}),
      }),
  };
}

function summary(report: RunwayReport, maxMissingDays: number): string {
  const state = isExceeded(report, maxMissingDays) ? 'exceeded' : 'healthy';
  return (
    `runway: ${String(report.days.length)} of ${String(report.windowDays)} days from ${report.from} to ` +
    `${report.to} lack approved notes (max ${String(maxMissingDays)}): ${state}`
  );
}

/** Runs the monitor. Exit code 0 on success (healthy or not), 1 on errors, 2 on usage errors. */
export async function runRunway(args: readonly string[], context: CliContext, io: CliIo): Promise<number> {
  const parsed = parseArgs(args);
  if (typeof parsed === 'string') {
    io.err(`${parsed}\n${USAGE}`);
    return 2;
  }
  const { runway, site } = context.config;
  try {
    const from = parsed.from ?? toIsoDateInZone(context.now(), site.timezone);
    if (parsed.dryRun) {
      const report = computeRunway({ from, windowDays: runway.windowDays, repo: context.repo });
      io.out(summary(report, runway.maxMissingDays));
      io.out(renderIssue(report, runway).body);
      return 0;
    }
    const result = await runMonitor({ from, config: runway, repo: context.repo, github: context.github() });
    io.out(summary(result.report, runway.maxMissingDays));
    const action = result.created ? 'created' : 'updated';
    io.out(`runway: issue #${String(result.issue.number)} ${action}, ${result.issue.state} (${result.issue.url})`);
    return 0;
  } catch (error) {
    io.err(`runway: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}
