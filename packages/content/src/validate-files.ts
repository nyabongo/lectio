/**
 * `npm run content:validate [files…]`: schema validation of passage, calendar and translation
 * (`passages/i18n/<locale>/<key>.json`, L-112) files for authors and seed PRs. A translation is
 * also checked against its English passage: it must exist, and ids and claim markers must line up. With no arguments it checks every file under the configured content
 * root. Cross-file rules (claims cited, keys matching refs) are gate 1's job (L-024).
 */
import { dirname, join, relative, resolve } from 'node:path';

import { findRepoRoot, loadConfig } from '@lectio/config';
import { localeSchema } from '@lectio/schema/common';
import { SOURCE_LOCALE_PATTERN } from '@lectio/schema/translated-passage';

import { ContentError } from './errors.ts';
import {
  CALENDAR_DIR,
  PASSAGES_DIR,
  TRANSLATIONS_DIR,
  checkContentText,
  checkPassage,
  checkTranslatedPassage,
  contentKindOf,
  isMissing,
  nodeFs,
  parseJson,
  translationPlaceOf,
} from './files.ts';
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

const LOCALE = new RegExp(localeSchema.pattern);
const SOURCE_LOCALE = new RegExp(SOURCE_LOCALE_PATTERN);

/** Every `passages/i18n/<locale>/*.json` under `root`, locales in name order. */
function translationFiles(fs: ContentFs, root: string): string[] {
  const dir = join(root, TRANSLATIONS_DIR);
  let entries: string[];
  try {
    entries = fs.readdir(dir);
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
  return entries
    .filter((locale) => LOCALE.test(locale) && !SOURCE_LOCALE.test(locale))
    .sort()
    .flatMap((locale) => listJson(fs, join(dir, locale)));
}

/** Every `calendar/*.json`, `passages/*.json` and `passages/i18n/<locale>/*.json` under `root`. */
export function contentFilesUnder(root: string, fs: ContentFs = nodeFs): string[] {
  return [
    ...listJson(fs, join(root, CALENDAR_DIR)),
    ...listJson(fs, join(root, PASSAGES_DIR)),
    ...translationFiles(fs, root),
  ];
}

/** Checks a translation file and its English passage (`<passages>/<key>.json`, three levels up). */
function checkTranslationFile(
  fs: ContentFs,
  path: string,
  display: string,
  place: { locale: string; key: string },
): void {
  const value = parseJson(fs.readFile(path), display);
  const englishPath = join(dirname(dirname(dirname(path))), `${place.key}.json`);
  let englishText: string;
  try {
    englishText = fs.readFile(englishPath);
  } catch (error) {
    if (!isMissing(error)) throw error;
    checkTranslatedPassage(value, display, place);
    throw new ContentError(display, [
      { pointer: '/translationOf', message: `the English passage passages/${place.key}.json does not exist` },
    ]);
  }
  let english;
  try {
    english = checkPassage(parseJson(englishText, englishPath), englishPath, place.key);
  } catch {
    // An invalid English passage is reported as its own file; the translation is checked alone.
    english = undefined;
  }
  checkTranslatedPassage(value, display, place, english);
}

function validateOne(fs: ContentFs, path: string, display: string): ContentError | null {
  const place = translationPlaceOf(path);
  const kind = contentKindOf(path);
  if (place === null && kind === null) {
    return new ContentError(display, [
      {
        pointer: '',
        message:
          'not a content file (expected passages/<key>.json, passages/i18n/<locale>/<key>.json or calendar/<year>.json)',
      },
    ]);
  }
  try {
    if (place !== null) checkTranslationFile(fs, path, display, place);
    else checkContentText(kind as NonNullable<typeof kind>, fs.readFile(path), display);
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
