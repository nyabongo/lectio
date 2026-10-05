import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import repoVitestConfig from '../../../vitest.config.ts';
import {
  checkCoverageFloor,
  checkCoverageIgnoreHints,
  checkDartThreshold,
  checkVitestCoverage,
  collectSourceFiles,
  COVERAGE_FLOOR,
  COVERAGE_IGNORE_ALLOWLIST,
  parseCoverageIgnoreAllowlist,
  readCoverageIgnoreInput,
  REPO_ROOT,
} from './coverage-floor.ts';

/**
 * Builds a coverage-ignore comment without writing one into this file (the
 * guard scans test files too), e.g. hint('v8', 'next') for the v8 "next" hint.
 */
const hint = (tool: string, rest = 'next') => `/* ${tool} ignore ${rest} */`;
/** The start of the problem reported for a hint by `tool` at `where` (`path:line`). */
const notAllowed = (where: string, tool: string) => `${where}: '${tool} ignore' comments are not allowed`;
const clean = { sources: [], allowlistSource: undefined };

const floor = { lines: 96, branches: 96, functions: 96, statements: 96 };
const include = ['packages/*/src/**/*.{ts,tsx,mts}', 'apps/*/src/lib/**/*.{ts,tsx,mts}', 'apps/web/src/sw/**'];

function config(coverage: Record<string, unknown>): unknown {
  return {
    test: {
      coverage: {
        include,
        exclude: ['**/*.d.ts', '**/*.test.*', '**/fixtures/**', '**/__generated__/**'],
        thresholds: { ...floor, ...Object.fromEntries(include.map((glob) => [glob, floor])) },
        ...coverage,
      },
    },
  };
}

describe('checkVitestCoverage', () => {
  it('accepts the repository vitest.config.ts', () => {
    expect(checkVitestCoverage(repoVitestConfig)).toEqual([]);
  });

  it('accepts a config at the floor', () => {
    expect(COVERAGE_FLOOR).toBe(96);
    expect(checkVitestCoverage(config({}))).toEqual([]);
  });

  it('fails when a global threshold is edited below 96', () => {
    const thresholds = { ...floor, branches: 95, ...Object.fromEntries(include.map((glob) => [glob, floor])) };
    expect(checkVitestCoverage(config({ thresholds }))).toEqual([
      'test.coverage.thresholds.branches is 95; it must be ≥ 96',
    ]);
  });

  it('fails when a per-glob threshold is below 96 or missing a metric', () => {
    const thresholds = {
      ...floor,
      [include[0] as string]: { ...floor, lines: 80 },
      [include[1] as string]: { lines: 96, branches: 96, functions: 96 },
      [include[2] as string]: floor,
    };
    expect(checkVitestCoverage(config({ thresholds }))).toEqual([
      `test.coverage.thresholds['${include[0]}'].lines is 80; it must be ≥ 96`,
      `test.coverage.thresholds['${include[1]}'].statements is missing; it must be a number ≥ 96`,
    ]);
  });

  it('fails when a glob has no per-glob threshold', () => {
    const thresholds = { ...floor, perFile: false };
    expect(checkVitestCoverage(config({ thresholds }))).toEqual(
      include.map((glob) => `test.coverage.thresholds has no per-glob entry for '${glob}'`),
    );
  });

  it('fails when thresholds are removed', () => {
    expect(checkVitestCoverage(config({ thresholds: undefined }))).toEqual(['test.coverage.thresholds is missing']);
  });

  const withGlobThresholds = (globs: string[]) => ({
    ...floor,
    ...Object.fromEntries(globs.map((glob) => [glob, floor])),
  });

  it('fails when a threshold is NaN, Infinity or not a number', () => {
    const thresholds = { ...withGlobThresholds(include), lines: Number.NaN, branches: '96', functions: Infinity };
    expect(checkVitestCoverage(config({ thresholds }))).toEqual([
      'test.coverage.thresholds.lines is NaN; it must be a finite number ≥ 96',
      'test.coverage.thresholds.branches is "96"; it must be a finite number ≥ 96',
      'test.coverage.thresholds.functions is Infinity; it must be a finite number ≥ 96',
    ]);
  });

  it('fails when the packages include is narrowed to *.ts', () => {
    const narrowed = ['packages/*/src/**/*.ts', include[1] as string, include[2] as string];
    expect(checkVitestCoverage(config({ include: narrowed, thresholds: withGlobThresholds(narrowed) }))).toEqual([
      "test.coverage.include must contain 'packages/*/src/**/*.{ts,tsx,mts}' verbatim",
    ]);
  });

  it('fails when the apps glob is dropped', () => {
    const dropped = [include[0] as string, include[2] as string];
    expect(checkVitestCoverage(config({ include: dropped, thresholds: withGlobThresholds(dropped) }))).toEqual([
      "test.coverage.include must contain 'apps/*/src/lib/**/*.{ts,tsx,mts}' verbatim",
    ]);
  });

  it('allows extra include globs (with thresholds) but not negated ones', () => {
    const wider = [...include, 'tools/**/*.ts'];
    expect(checkVitestCoverage(config({ include: wider, thresholds: withGlobThresholds(wider) }))).toEqual([]);
    const negated = [...include, '!packages/refs/**'];
    expect(checkVitestCoverage(config({ include: negated, thresholds: withGlobThresholds(negated) }))).toEqual([
      "test.coverage.include must not contain negated glob '!packages/refs/**'",
    ]);
  });

  it('fails when exclude gains anything beyond the four allowed globs', () => {
    const exclude = [
      '**/*.d.ts',
      '**/*.test.*',
      '**/fixtures/**',
      '**/__generated__/**',
      '**/cli/**',
      'packages/refs/**',
    ];
    expect(checkVitestCoverage(config({ exclude }))).toEqual([
      "test.coverage.exclude must not contain '**/cli/**'",
      "test.coverage.exclude must not contain 'packages/refs/**'",
    ]);
  });

  it('accepts a subset of the allowed excludes', () => {
    expect(checkVitestCoverage(config({ exclude: ['**/*.test.*'] }))).toEqual([]);
  });

  it('fails when exclude is missing (vitest defaults would apply) or malformed', () => {
    const expected = [
      'test.coverage.exclude must be a list drawn from ["**/*.d.ts","**/*.test.*","**/fixtures/**","**/__generated__/**"]',
    ];
    expect(checkVitestCoverage(config({ exclude: undefined }))).toEqual(expected);
    expect(checkVitestCoverage(config({ exclude: [1] }))).toEqual(expected);
  });

  it('fails when include is missing, empty or malformed', () => {
    const missingAll = include.map((glob) => `test.coverage.include must contain '${glob}' verbatim`);
    expect(checkVitestCoverage(config({ include: undefined }))).toEqual([
      'test.coverage.include must be a list of globs',
    ]);
    expect(checkVitestCoverage(config({ include: [] }))).toEqual(missingAll);
    expect(checkVitestCoverage(config({ include: [1, 2] }))).toEqual(['test.coverage.include must be a list of globs']);
  });

  it('fails without a coverage block', () => {
    const expected = ['vitest config has no test.coverage block'];
    expect(checkVitestCoverage({ test: {} })).toEqual(expected);
    expect(checkVitestCoverage({})).toEqual(expected);
    expect(checkVitestCoverage(null)).toEqual(expected);
  });
});

describe('checkDartThreshold', () => {
  it.each([
    'const double minCoverage = 96;',
    'const minCoverage = 96.0;',
    'final threshold = 97;',
    'const int coverageThreshold = 100;',
  ])('accepts %s', (line) => {
    expect(checkDartThreshold(`void main() {}\n${line}\n`)).toEqual([]);
  });

  it('fails when the Dart threshold is edited below 96', () => {
    expect(checkDartThreshold('const double minCoverage = 95.5;')).toEqual([
      'apps/mobile/tool/check_coverage.dart: minCoverage is 95.5; it must be ≥ 96',
    ]);
  });

  it('fails when no threshold is declared', () => {
    expect(checkDartThreshold('void main() { print(96); }')[0]).toContain('declares no threshold');
  });
});

describe('checkCoverageFloor', () => {
  it('ignores Dart while apps/mobile does not exist', () => {
    expect(checkCoverageFloor({ vitestConfig: config({}), coverageIgnore: clean })).toEqual([]);
  });

  it('combines vitest and Dart problems', () => {
    const vitestConfig = config({ thresholds: undefined });
    const coverageIgnore = { sources: [{ path: 'packages/a/src/a.ts', source: hint('c8') }] };
    expect(checkCoverageFloor({ vitestConfig, dartSource: 'const minCoverage = 90;', coverageIgnore })).toEqual([
      'test.coverage.thresholds is missing',
      'apps/mobile/tool/check_coverage.dart: minCoverage is 90; it must be ≥ 96',
      expect.stringContaining(notAllowed('packages/a/src/a.ts:1', 'c8')),
    ]);
  });

  it('scans the repository itself when no sources are given', () => {
    expect(checkCoverageFloor({ vitestConfig: repoVitestConfig })).toEqual([]);
  });
});

describe('checkCoverageIgnoreHints', () => {
  const file = (path: string, source: string) => ({ path, source });

  it('accepts sources without hints', () => {
    expect(checkCoverageIgnoreHints({ sources: [file('packages/a/src/a.ts', 'export const a = 1;')] })).toEqual([]);
  });

  it('fails on every v8, c8 and istanbul hint, with file, line and a clear message', () => {
    const source = [
      'export function f(x: number) {',
      `  ${hint('v8')}`,
      '  if (x) return 1;',
      `  // ${'c8'} ignore start`,
      `  ${hint('istanbul', 'else')}`,
      `  return ${hint('v8', 'next -- @preserve')} 2;`,
      '}',
    ].join('\n');
    const problems = checkCoverageIgnoreHints({ sources: [file('packages/a/src/a.test.ts', source)] });
    expect(problems).toEqual([
      `${notAllowed('packages/a/src/a.test.ts:2', 'v8')}; they hide code from the 96% coverage floor. ` +
        `Test the code instead, or (owner review) list the file in ${COVERAGE_IGNORE_ALLOWLIST} with a reason`,
      expect.stringContaining(notAllowed('packages/a/src/a.test.ts:4', 'c8')),
      expect.stringContaining(notAllowed('packages/a/src/a.test.ts:5', 'istanbul')),
      expect.stringContaining(notAllowed('packages/a/src/a.test.ts:6', 'v8')),
    ]);
  });

  it('matches legal comments, JSX comments and odd spacing or case', () => {
    const sources = [
      file('apps/web/src/a.astro', `/*! ${'v8'}  ignore file */`),
      file('apps/web/src/b.tsx', `{/* ${'V8'} IGNORE next */}`),
    ];
    expect(checkCoverageIgnoreHints({ sources })).toHaveLength(2);
  });

  it('does not match words that only contain the tool names', () => {
    expect(
      checkCoverageIgnoreHints({ sources: [file('packages/a/src/a.ts', '// abc8 ignored; nov8 ignore')] }),
    ).toEqual([]);
  });

  it('allows hints in allowlisted files and flags stale allowlist entries', () => {
    const allowlistSource = JSON.stringify({
      files: [
        { path: 'packages/a/src/glue.ts', reason: 'platform branch' },
        { path: 'packages/a/src/gone.ts', reason: 'old' },
      ],
    });
    const sources = [
      file('packages/a/src/glue.ts', `${hint('v8')}\n${hint('v8')}`),
      file('packages/a/src/b.ts', hint('v8')),
    ];
    expect(checkCoverageIgnoreHints({ sources, allowlistSource })).toEqual([
      expect.stringMatching(/^packages\/a\/src\/b\.ts:1: /),
      `${COVERAGE_IGNORE_ALLOWLIST}: 'packages/a/src/gone.ts' has no coverage-ignore comments; remove the entry`,
    ]);
  });

  it('reports a malformed allowlist', () => {
    expect(checkCoverageIgnoreHints({ sources: [], allowlistSource: '{' })[0]).toMatch(
      new RegExp(`^${COVERAGE_IGNORE_ALLOWLIST.replace(/\./g, '\\.')}: not valid JSON`),
    );
  });
});

describe('parseCoverageIgnoreAllowlist', () => {
  const shape = `${COVERAGE_IGNORE_ALLOWLIST} must be { "files": [{ "path": "<file>", "reason": "<why>" }] }`;

  it('treats a missing file and an empty list as an empty allowlist', () => {
    expect(parseCoverageIgnoreAllowlist(undefined)).toEqual({ paths: [], problems: [] });
    expect(parseCoverageIgnoreAllowlist('{"files":[]}')).toEqual({ paths: [], problems: [] });
  });

  it('rejects other shapes and entries without a path or reason', () => {
    expect(parseCoverageIgnoreAllowlist('[]')).toEqual({ paths: [], problems: [shape] });
    expect(parseCoverageIgnoreAllowlist('{"files":{}}')).toEqual({ paths: [], problems: [shape] });
    const source = JSON.stringify({
      files: [
        { path: 'a.ts', reason: 'ok' },
        { path: 'b.ts' },
        { path: '', reason: 'x' },
        { path: 'c.ts', reason: ' ' },
        'd.ts',
      ],
    });
    const { paths, problems } = parseCoverageIgnoreAllowlist(source);
    expect(paths).toEqual(['a.ts']);
    expect(problems).toEqual([
      `${COVERAGE_IGNORE_ALLOWLIST}: entry {"path":"b.ts"} needs a "path" and a "reason"`,
      `${COVERAGE_IGNORE_ALLOWLIST}: entry {"path":"","reason":"x"} needs a "path" and a "reason"`,
      `${COVERAGE_IGNORE_ALLOWLIST}: entry {"path":"c.ts","reason":" "} needs a "path" and a "reason"`,
      `${COVERAGE_IGNORE_ALLOWLIST}: entry "d.ts" needs a "path" and a "reason"`,
    ]);
  });
});

describe('reading a checkout', () => {
  let root: string | undefined;
  afterEach(() => {
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
    root = undefined;
  });

  const write = (base: string, path: string, content: string) => {
    mkdirSync(dirname(join(base, path)), { recursive: true });
    writeFileSync(join(base, path), content);
  };

  it('collects sources under packages/*/src and apps/*/src only, skipping node_modules and non-code files', () => {
    root = mkdtempSync(join(tmpdir(), 'lectio-coverage-'));
    write(root, 'packages/b/src/deep/x.test.ts', hint('v8'));
    write(root, 'packages/a/src/index.mts', 'export {};');
    write(root, 'packages/a/src/notes.md', hint('v8'));
    write(root, 'packages/a/src/node_modules/dep/index.js', hint('v8'));
    write(root, 'packages/a/test/outside.ts', hint('v8'));
    write(root, 'packages/README.md', '');
    write(root, 'packages/no-src/package.json', '{}');
    write(root, 'apps/web/src/sw/sw.js', '');
    expect(collectSourceFiles(root).map((f) => f.path)).toEqual([
      'apps/web/src/sw/sw.js',
      'packages/a/src/index.mts',
      'packages/b/src/deep/x.test.ts',
    ]);
    expect(readCoverageIgnoreInput(root).allowlistSource).toBeUndefined();
  });

  it('fails the floor when a test file in a package carries a v8 hint, until it is allowlisted', () => {
    root = mkdtempSync(join(tmpdir(), 'lectio-coverage-'));
    write(root, 'packages/a/src/a.test.ts', `it('x', () => {\n  ${hint('v8')}\n});\n`);
    const vitestConfig = config({});
    expect(checkCoverageFloor({ vitestConfig, coverageIgnore: readCoverageIgnoreInput(root) })).toEqual([
      expect.stringContaining(notAllowed('packages/a/src/a.test.ts:2', 'v8')),
    ]);
    write(
      root,
      COVERAGE_IGNORE_ALLOWLIST,
      JSON.stringify({ files: [{ path: 'packages/a/src/a.test.ts', reason: 'demo' }] }),
    );
    expect(checkCoverageFloor({ vitestConfig, coverageIgnore: readCoverageIgnoreInput(root) })).toEqual([]);
  });

  it('handles a checkout without apps/', () => {
    root = mkdtempSync(join(tmpdir(), 'lectio-coverage-'));
    expect(collectSourceFiles(root)).toEqual([]);
  });

  it('finds the repository root and its committed allowlist', () => {
    expect(readCoverageIgnoreInput(REPO_ROOT).allowlistSource).toBeDefined();
    expect(collectSourceFiles(REPO_ROOT).map((f) => f.path)).toContain('packages/shared/src/coverage-floor.ts');
  });
});
