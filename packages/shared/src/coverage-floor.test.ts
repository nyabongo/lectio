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

  it('fails when include stops covering packages/*/src or apps/web/src/sw', () => {
    const narrowed = ['packages/refs/src/**/*.ts'];
    const problems = checkVitestCoverage(
      config({ include: narrowed, thresholds: { ...floor, [narrowed[0] as string]: floor } }),
    );
    expect(problems).toEqual([
      'test.coverage.include no longer covers packages/any-package/src/index.ts',
      'test.coverage.include no longer covers packages/any-package/src/nested/module.ts',
      'test.coverage.include no longer covers apps/web/src/sw/index.ts',
    ]);
  });

  it('fails when exclude removes covered sources', () => {
    const problems = checkVitestCoverage(config({ exclude: ['apps/web/src/sw/**'] }));
    expect(problems).toEqual(['test.coverage.exclude removes apps/web/src/sw/index.ts from coverage']);
  });

  it('treats a missing exclude list as excluding nothing', () => {
    expect(checkVitestCoverage(config({ exclude: undefined }))).toEqual([]);
  });

  it('fails when include is missing, empty or malformed', () => {
    const expected = ['test.coverage.include must list the source globs to measure'];
    expect(checkVitestCoverage(config({ include: undefined }))).toEqual(expected);
    expect(checkVitestCoverage(config({ include: [] }))).toEqual(expected);
    expect(checkVitestCoverage(config({ include: [1, 2] }))).toEqual(expected);
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
