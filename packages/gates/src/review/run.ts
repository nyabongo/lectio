/**
 * `npm run review:approve -- <files…> --reviewer <handle>`: records a local human approval
 * (`approvedVia: cli`) on passage files. Logic for ./cli.ts.
 */
import { relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { loadConfig } from '@lectio/config';
import type { LectioConfig } from '@lectio/config';

import { ReviewError, approveHuman } from './approve.ts';
import type { WriteOptions } from './approve.ts';

export const APPROVE_USAGE = 'usage: npm run review:approve -- <passages/KEY.json …> --reviewer <github-handle>';

export interface ApproveCliOptions extends WriteOptions {
  /** Where npm was invoked (`INIT_CWD`); relative paths start here. */
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly now: () => Date;
  readonly log: (line: string) => void;
  readonly error: (line: string) => void;
  /** Defaults to `loadConfig` from `cwd`. */
  readonly config?: Pick<LectioConfig, 'reviewer'>;
}

/** Runs the CLI and returns its exit code: 0 done, 1 refused, 2 usage error. */
export async function runApprove(args: readonly string[], options: ApproveCliOptions): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: args.filter((arg) => arg !== '--'),
      options: { reviewer: { type: 'string' }, help: { type: 'boolean', short: 'h' } },
      allowPositionals: true,
      strict: true,
    });
  } catch (error) {
    options.error(`review:approve: ${(error as Error).message}`);
    options.error(APPROVE_USAGE);
    return 2;
  }
  const { values, positionals } = parsed;
  if (values.help === true) {
    options.log(APPROVE_USAGE);
    return 0;
  }
  if (values.reviewer === undefined || positionals.length === 0) {
    options.error(APPROVE_USAGE);
    return 2;
  }
  try {
    const config = options.config ?? loadConfig(undefined, { cwd: options.cwd, env: options.env });
    const files = positionals.map((file) => resolve(options.cwd, file));
    const outcomes = await approveHuman(files, {
      reviewer: values.reviewer,
      via: 'cli',
      now: options.now(),
      config,
      ...(options.fs === undefined ? {} : { fs: options.fs }),
      ...(options.format === undefined ? {} : { format: options.format }),
    });
    for (const outcome of outcomes) {
      options.log(`${outcome.changed ? 'approved' : 'unchanged'} ${relative(options.cwd, outcome.file)}`);
    }
    return 0;
  } catch (error) {
    if (!(error instanceof ReviewError)) throw error;
    options.error(`review:approve: ${error.message}`);
    return 1;
  }
}
