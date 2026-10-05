/**
 * The 96% coverage floor, checked against the configuration itself rather than
 * a coverage run: `npm run coverage:floor` (scripts/check-coverage-floor.mjs)
 * fails if anyone lowers a vitest threshold (or sets it to a non-number), drops
 * or rewrites one of the canonical `coverage.include` globs, adds anything to
 * `coverage.exclude` beyond the four allowed globs, or lowers the Dart threshold
 * in `apps/mobile/tool/check_coverage.dart`. It also fails on coverage-ignore
 * hints (see `COVERAGE_IGNORE_HINT`) in any source file under
 * `packages/<name>/src` or `apps/<name>/src`, test files included, and in any
 * Dart file under `apps/<name>/lib` (the Flutter app, L-100), unless the file
 * is listed in `.github/coverage-ignore-allowlist.json`. The ESLint
 * rule `lectio/no-coverage-ignore` (eslint.config.js) reports the same comments
 * earlier, in `npm run lint`; this check is the one an inline eslint-disable
 * cannot silence.
 *
 * Guarded by CODEOWNERS together with vitest.config.ts and the allowlist.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const COVERAGE_FLOOR = 96;

export const COVERAGE_METRICS = ['lines', 'branches', 'functions', 'statements'] as const;
export type CoverageMetric = (typeof COVERAGE_METRICS)[number];

/** `coverage.include` must contain each of these globs verbatim (extra globs only widen coverage). */
export const CANONICAL_INCLUDE = [
  'packages/*/src/**/*.{ts,tsx,mts}',
  'apps/*/src/lib/**/*.{ts,tsx,mts}',
  'apps/web/src/sw/**',
] as const;

/** `coverage.exclude` may contain only these globs (L-001: "exclude only …"). */
export const ALLOWED_EXCLUDE = ['**/*.d.ts', '**/*.test.*', '**/fixtures/**', '**/__generated__/**'] as const;

/** Where the Flutter app (L-100) keeps its coverage gate. */
export const DART_COVERAGE_CHECK = 'apps/mobile/tool/check_coverage.dart';

/**
 * A Dart declaration of the threshold, e.g. `const double minCoverage = 96;`
 * or `final threshold = 96.0;`. Any `const`/`final` whose name contains
 * "coverage" or "threshold" and whose value is a number literal counts.
 */
const DART_THRESHOLD =
  /\b(?:const|final)\s+(?:(?:double|int|num)\s+)?(\w*(?:[Cc]overage|[Tt]hreshold)\w*)\s*=\s*(\d+(?:\.\d+)?)\s*;/g;

/** The owner-reviewed list of files allowed to carry coverage-ignore hints (CODEOWNERS covers it). */
export const COVERAGE_IGNORE_ALLOWLIST = '.github/coverage-ignore-allowlist.json';

/**
 * A coverage-ignore hint, as honoured by the coverage tools this repo can run:
 * - `v8`, `c8` or `istanbul`, then `ignore` (ast-v8-to-istanbul, c8, nyc);
 * - `node:coverage`, then `ignore` or `disable` (the Node test runner and
 *   ast-v8-to-istanbul), and for safety any other `<word>:coverage` prefix;
 * - Dart's `coverage:` + `ignore-line`/`-start`/`-end`/`-file` (package:coverage),
 *   and any other `coverage:` + `ignore` form.
 *
 * Any comment style counts (`/* … *\/`, `/*! … *\/`, `//`, `{/* … *\/}`), with
 * any suffix (`next`, `start`, `if`, `else`, `file`, `-- @preserve`), in any
 * case. Matched on the raw text, so a hint inside a string literal counts too.
 *
 * eslint.config.js keeps an identical copy (without the `g` flag); a test in
 * coverage-floor.test.ts fails if the two drift apart. (`(?:ignore)` keeps this
 * file from matching its own pattern.)
 */
export const COVERAGE_IGNORE_HINT =
  /\b(?:(?:v8|c8|istanbul)\s+ignore|[\w-]+:coverage\s+(?:ignore|disable)|coverage:(?:ignore))\b/gi;

/** Source extensions scanned for hints under `packages/<name>/src` and `apps/<name>/src`. */
const SCANNED_SOURCE = /\.(?:[cm]?[jt]sx?|astro|svelte|vue)$/;

/** Flutter sources scanned for hints under `apps/<name>/lib`. */
const SCANNED_DART = /\.dart$/;

/** The repository root (this file is packages/shared/src/coverage-floor.ts). */
export const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

export interface SourceFile {
  /** Repository-relative path with forward slashes, e.g. `packages/refs/src/parse.ts`. */
  path: string;
  source: string;
}

export interface CoverageIgnoreInput {
  /** Every scanned source file. */
  sources: SourceFile[];
  /** Contents of .github/coverage-ignore-allowlist.json, or undefined when it does not exist. */
  allowlistSource?: string | undefined;
}

export interface CoverageFloorInput {
  /** The resolved vitest config object (the default export of vitest.config.ts). */
  vitestConfig: unknown;
  /** Contents of apps/mobile/tool/check_coverage.dart, or undefined when the file does not exist. */
  dartSource?: string | undefined;
  /** Sources and allowlist to scan for coverage-ignore hints; read from `REPO_ROOT` when omitted. */
  coverageIgnore?: CoverageIgnoreInput | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.every((item) => typeof item === 'string') ? value : undefined;
}

function checkMetrics(where: string, thresholds: Record<string, unknown>): string[] {
  const problems: string[] = [];
  for (const metric of COVERAGE_METRICS) {
    const value = thresholds[metric];
    if (value === undefined) {
      problems.push(`${where}.${metric} is missing; it must be a number ≥ ${COVERAGE_FLOOR}`);
    } else if (typeof value !== 'number' || !Number.isFinite(value)) {
      problems.push(
        `${where}.${metric} is ${typeof value === 'number' ? String(value) : JSON.stringify(value)}; it must be a finite number ≥ ${COVERAGE_FLOOR}`,
      );
    } else if (value < COVERAGE_FLOOR) {
      problems.push(`${where}.${metric} is ${value}; it must be ≥ ${COVERAGE_FLOOR}`);
    }
  }
  return problems;
}

/** Problems with the vitest coverage configuration (empty when it holds the floor). */
export function checkVitestCoverage(vitestConfig: unknown): string[] {
  const test = isRecord(vitestConfig) ? vitestConfig['test'] : undefined;
  const coverage = isRecord(test) ? test['coverage'] : undefined;
  if (!isRecord(coverage)) return ['vitest config has no test.coverage block'];

  const problems: string[] = [];
  const thresholds = coverage['thresholds'];
  if (!isRecord(thresholds)) {
    problems.push('test.coverage.thresholds is missing');
  } else {
    problems.push(...checkMetrics('test.coverage.thresholds', thresholds));
    for (const [key, value] of Object.entries(thresholds)) {
      if (isRecord(value)) problems.push(...checkMetrics(`test.coverage.thresholds['${key}']`, value));
    }
  }

  const include = stringList(coverage['include']);
  if (include === undefined) {
    problems.push('test.coverage.include must be a list of globs');
  } else {
    for (const glob of CANONICAL_INCLUDE) {
      if (!include.includes(glob)) problems.push(`test.coverage.include must contain '${glob}' verbatim`);
    }
    for (const glob of include) {
      if (glob.startsWith('!')) problems.push(`test.coverage.include must not contain negated glob '${glob}'`);
      if (isRecord(thresholds) && !isRecord(thresholds[glob])) {
        problems.push(`test.coverage.thresholds has no per-glob entry for '${glob}'`);
      }
    }
  }

  const exclude = stringList(coverage['exclude']);
  const allowed: readonly string[] = ALLOWED_EXCLUDE;
  if (exclude === undefined) {
    problems.push(`test.coverage.exclude must be a list drawn from ${JSON.stringify(ALLOWED_EXCLUDE)}`);
  } else {
    for (const glob of exclude) {
      if (!allowed.includes(glob)) problems.push(`test.coverage.exclude must not contain '${glob}'`);
    }
  }
  return problems;
}

/** Problems with the Dart coverage gate (empty when it holds the floor). */
export function checkDartThreshold(source: string): string[] {
  const matches = [...source.matchAll(DART_THRESHOLD)];
  if (matches.length === 0) {
    return [
      `${DART_COVERAGE_CHECK} declares no threshold; declare it as e.g. \`const double minCoverage = ${COVERAGE_FLOOR};\``,
    ];
  }
  return matches
    .filter((match) => Number(match[2]) < COVERAGE_FLOOR)
    .map(
      (match) => `${DART_COVERAGE_CHECK}: ${String(match[1])} is ${String(match[2])}; it must be ≥ ${COVERAGE_FLOOR}`,
    );
}

/**
 * Parses the allowlist: `{ "files": [{ "path": "<repo-relative file>", "reason": "<why>" }] }`.
 * A missing file is an empty allowlist. Returns the allowed paths and any problems with the file.
 */
export function parseCoverageIgnoreAllowlist(source: string | undefined): { paths: string[]; problems: string[] } {
  if (source === undefined) return { paths: [], problems: [] };
  const shape = `${COVERAGE_IGNORE_ALLOWLIST} must be { "files": [{ "path": "<file>", "reason": "<why>" }] }`;
  let data: unknown;
  try {
    data = JSON.parse(source);
  } catch (error) {
    return { paths: [], problems: [`${COVERAGE_IGNORE_ALLOWLIST}: not valid JSON (${(error as Error).message})`] };
  }
  const files = isRecord(data) ? data['files'] : undefined;
  if (!Array.isArray(files)) return { paths: [], problems: [shape] };
  const paths: string[] = [];
  const problems: string[] = [];
  for (const entry of files) {
    const path = isRecord(entry) ? entry['path'] : undefined;
    const reason = isRecord(entry) ? entry['reason'] : undefined;
    if (typeof path !== 'string' || path === '' || typeof reason !== 'string' || reason.trim() === '') {
      problems.push(`${COVERAGE_IGNORE_ALLOWLIST}: entry ${JSON.stringify(entry)} needs a "path" and a "reason"`);
    } else {
      paths.push(path);
    }
  }
  return { paths, problems };
}

/** Problems for coverage-ignore hints outside the allowlist, and for allowlist entries that no longer need it. */
export function checkCoverageIgnoreHints({ sources, allowlistSource }: CoverageIgnoreInput): string[] {
  const allowlist = parseCoverageIgnoreAllowlist(allowlistSource);
  const problems = [...allowlist.problems];
  const used = new Set<string>();
  for (const { path, source } of sources) {
    for (const match of source.matchAll(COVERAGE_IGNORE_HINT)) {
      if (allowlist.paths.includes(path)) {
        used.add(path);
        continue;
      }
      const line = source.slice(0, match.index).split('\n').length;
      problems.push(
        `${path}:${line}: '${match[0]}' comments are not allowed; they hide code from the ${COVERAGE_FLOOR}% coverage floor. ` +
          `Test the code instead, or (owner review) list the file in ${COVERAGE_IGNORE_ALLOWLIST} with a reason`,
      );
    }
  }
  for (const path of allowlist.paths) {
    if (!used.has(path)) {
      problems.push(`${COVERAGE_IGNORE_ALLOWLIST}: '${path}' has no coverage-ignore comments; remove the entry`);
    }
  }
  return problems;
}

function walk(dir: string, scanned: RegExp, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, scanned, out);
    else if (entry.isFile() && scanned.test(entry.name)) out.push(path);
  }
}

/** Where to look: `<group>/<name>/<dir>/**` for files matching `scanned`. */
const SCAN_ROOTS: readonly { group: string; dir: string; scanned: RegExp }[] = [
  { group: 'packages', dir: 'src', scanned: SCANNED_SOURCE },
  { group: 'apps', dir: 'src', scanned: SCANNED_SOURCE },
  { group: 'apps', dir: 'lib', scanned: SCANNED_DART },
];

/**
 * Every scanned file of `root`, sorted by path: sources under `packages/<name>/src`
 * and `apps/<name>/src`, and Dart files under `apps/<name>/lib`.
 */
export function collectSourceFiles(root: string): SourceFile[] {
  const files: string[] = [];
  for (const { group, dir, scanned } of SCAN_ROOTS) {
    const base = join(root, group);
    if (!existsSync(base)) continue;
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      const target = join(base, entry.name, dir);
      if (entry.isDirectory() && existsSync(target)) walk(target, scanned, files);
    }
  }
  return files
    .map((file) => ({ path: relative(root, file).split(sep).join('/'), source: readFileSync(file, 'utf8') }))
    .sort((a, b) => (a.path < b.path ? -1 : 1));
}

/** Reads the sources and the allowlist from a repository checkout. */
export function readCoverageIgnoreInput(root: string): CoverageIgnoreInput {
  const allowlist = join(root, COVERAGE_IGNORE_ALLOWLIST);
  return {
    sources: collectSourceFiles(root),
    allowlistSource: existsSync(allowlist) ? readFileSync(allowlist, 'utf8') : undefined,
  };
}

/** Every reason the repository falls below the coverage floor; empty when it holds. */
export function checkCoverageFloor(input: CoverageFloorInput): string[] {
  return [
    ...checkVitestCoverage(input.vitestConfig),
    ...(input.dartSource === undefined ? [] : checkDartThreshold(input.dartSource)),
    ...checkCoverageIgnoreHints(input.coverageIgnore ?? readCoverageIgnoreInput(REPO_ROOT)),
  ];
}
