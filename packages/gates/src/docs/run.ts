/**
 * `npm run gates:docs [-- --check]`: writes docs/gates.md from the rule registry (./generate.ts),
 * or with `--check` only compares and exits 1 when the file is out of date. Logic for ./cli.ts.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import { findRepoRoot } from '@lectio/config';

import { GATES_DOC_PATH, renderGatesDoc } from './generate.ts';

export const DOCS_USAGE = 'usage: npm run gates:docs [-- --check]';

export interface GatesDocsCliOptions {
  /** Where npm was invoked (`INIT_CWD`); the repository root is found from here. */
  readonly cwd: string;
  readonly log: (line: string) => void;
  readonly error: (line: string) => void;
  /** Defaults to `renderGatesDoc()`. */
  readonly render?: () => Promise<string>;
  /** Returns `null` when the file does not exist. */
  readonly readFile?: (path: string) => string | null;
  readonly writeFile?: (path: string, text: string) => void;
}

function nodeReadFile(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    if ((error as { code?: unknown }).code === 'ENOENT') return null;
    throw error;
  }
}

/** Runs the CLI and returns its exit code: 0 written or in sync, 1 out of date (`--check`), 2 usage error. */
export async function runGatesDocs(args: readonly string[], options: GatesDocsCliOptions): Promise<number> {
  let values;
  try {
    ({ values } = parseArgs({
      args: args.filter((arg) => arg !== '--'),
      options: { check: { type: 'boolean' }, help: { type: 'boolean', short: 'h' } },
      strict: true,
    }));
  } catch (error) {
    options.error(`gates:docs: ${(error as Error).message}`);
    options.error(DOCS_USAGE);
    return 2;
  }
  if (values.help === true) {
    options.log(DOCS_USAGE);
    return 0;
  }
  const target = join(findRepoRoot(options.cwd), GATES_DOC_PATH);
  const text = await (options.render ?? renderGatesDoc)();
  const current = (options.readFile ?? nodeReadFile)(target);
  if (values.check === true) {
    if (current === text) {
      options.log(`${GATES_DOC_PATH} is up to date`);
      return 0;
    }
    options.error(`gates:docs: ${GATES_DOC_PATH} is out of date; run npm run gates:docs`);
    return 1;
  }
  if (current === text) {
    options.log(`${GATES_DOC_PATH} unchanged`);
    return 0;
  }
  (options.writeFile ?? ((path, body) => writeFileSync(path, body)))(target, text);
  options.log(`wrote ${GATES_DOC_PATH}`);
  return 0;
}
