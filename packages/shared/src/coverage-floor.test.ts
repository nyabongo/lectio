import { describe, expect, it } from 'vitest';

import repoVitestConfig from '../../../vitest.config.ts';
import { checkCoverageFloor, checkDartThreshold, checkVitestCoverage, COVERAGE_FLOOR } from './coverage-floor.ts';

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
    expect(checkCoverageFloor({ vitestConfig: config({}) })).toEqual([]);
  });

  it('combines vitest and Dart problems', () => {
    const vitestConfig = config({ thresholds: undefined });
    expect(checkCoverageFloor({ vitestConfig, dartSource: 'const minCoverage = 90;' })).toEqual([
      'test.coverage.thresholds is missing',
      'apps/mobile/tool/check_coverage.dart: minCoverage is 90; it must be ≥ 96',
    ]);
  });
});
