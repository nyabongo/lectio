/**
 * `npm run content:validate [files…]`: schema validation of passage and calendar files for
 * authors and seed PRs. With no arguments it checks every file under the configured content
 * root. Cross-file rules (claims cited, keys matching refs) are gate 1's job (L-024).
 */
import { join, relative, resolve } from 'node:path';

import { findRepoRoot, loadConfig } from '@lectio/config';

import { ContentError } from './errors.ts';
import { CALENDAR_DIR, PASSAGES_DIR, checkContentText, contentKindOf, isMissing, nodeFs } from './files.ts';
import type { ContentFs } from './files.ts';

export interface ValidationReport {
  /** Every file checked, as displayed (relative to the working directory). */
  readonly files: readonly string[];
  /** One error per invalid file. */
  readonly errors: readonly ContentError[];
}

function listJson(fs: ContentFs, dir: string): string[] {
  try {
    return fs
      .readdir(dir)
      .filter((name) => name.endsWith('.json'))
      .sort()
      .map((name) => join(dir, name));
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
}

/** Every `calendar/*.json` and `passages/*.json` under `root`. */
export function contentFilesUnder(root: string, fs: ContentFs = nodeFs): string[] {
  return [...listJson(fs, join(root, CALENDAR_DIR)), ...listJson(fs, join(root, PASSAGES_DIR))];
}

function validateOne(fs: ContentFs, path: string, display: string): ContentError | null {
  const kind = contentKindOf(path);
  if (kind === null) {
    return new ContentError(display, [
      { pointer: '', message: 'not a content file (expected passages/<key>.json or calendar/<year>.json)' },
    ]);
  }
  try {
    checkContentText(kind, fs.readFile(path), display);
    return null;
  } catch (error) {
    if (error instanceof ContentError) return error;
    return new ContentError(display, [{ pointer: '', message: `cannot read file (${(error as Error).message})` }]);
  }
}

/** Validates each file (absolute or relative to `cwd`); files are displayed relative to `cwd`. */
export function validateContentFiles(paths: readonly string[], cwd: string, fs: ContentFs = nodeFs): ValidationReport {
  const files: string[] = [];
  const errors: ContentError[] = [];
  for (const path of paths) {
    const absolute = resolve(cwd, path);
    const display = relative(cwd, absolute);
    files.push(display);
    const error = validateOne(fs, absolute, display);
    if (error !== null) errors.push(error);
  }
  return { files, errors };
}

export interface ValidateCliOptions {
  /** Where npm was invoked (`INIT_CWD`); relative paths start here. */
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly fs?: ContentFs;
  readonly log: (line: string) => void;
  readonly error: (line: string) => void;
}

/** Runs the CLI: validates `args` (or the whole content root) and returns the exit code. */
export function runValidate(args: readonly string[], options: ValidateCliOptions): number {
  const fs = options.fs ?? nodeFs;
  const files = args.filter((arg) => arg !== '--');
  let targets: string[] = files;
  if (targets.length === 0) {
    const config = loadConfig(undefined, { cwd: options.cwd, env: options.env });
    targets = contentFilesUnder(resolve(findRepoRoot(options.cwd), config.content.root), fs);
    if (targets.length === 0) {
      options.log('content:validate: no content files found');
      return 0;
    }
  }
  const report = validateContentFiles(targets, options.cwd, fs);
  for (const error of report.errors) options.error(error.message);
  const total = report.files.length;
  if (report.errors.length > 0) {
    options.error(`content:validate: ${String(report.errors.length)} of ${String(total)} files invalid`);
    return 1;
  }
  options.log(`content:validate: ${String(total)} files valid`);
  return 0;
}
