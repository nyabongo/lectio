/**
 * The 96% coverage floor, checked against the configuration itself rather than
 * a coverage run: `npm run coverage:floor` (scripts/check-coverage-floor.mjs)
 * fails if anyone lowers a vitest threshold, narrows `coverage.include` so that
 * package sources or the service worker escape measurement, or lowers the Dart
 * threshold in `apps/mobile/tool/check_coverage.dart`.
 *
 * Guarded by CODEOWNERS together with vitest.config.ts.
 */
import picomatch from 'picomatch';

export const COVERAGE_FLOOR = 96;

export const COVERAGE_METRICS = ['lines', 'branches', 'functions', 'statements'] as const;
export type CoverageMetric = (typeof COVERAGE_METRICS)[number];

/** Representative files that must always be inside `coverage.include` (and not excluded). */
export const MUST_BE_COVERED = [
  'packages/any-package/src/index.ts',
  'packages/any-package/src/nested/module.ts',
  'apps/web/src/sw/index.ts',
] as const;

/** Where the Flutter app (L-100) keeps its coverage gate. */
export const DART_COVERAGE_CHECK = 'apps/mobile/tool/check_coverage.dart';

/**
 * A Dart declaration of the threshold, e.g. `const double minCoverage = 96;`
 * or `final threshold = 96.0;`. Any `const`/`final` whose name contains
 * "coverage" or "threshold" and whose value is a number literal counts.
 */
const DART_THRESHOLD =
  /\b(?:const|final)\s+(?:(?:double|int|num)\s+)?(\w*(?:[Cc]overage|[Tt]hreshold)\w*)\s*=\s*(\d+(?:\.\d+)?)\s*;/g;

export interface CoverageFloorInput {
  /** The resolved vitest config object (the default export of vitest.config.ts). */
  vitestConfig: unknown;
  /** Contents of apps/mobile/tool/check_coverage.dart, or undefined when the file does not exist. */
  dartSource?: string | undefined;
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
    if (typeof value !== 'number') {
      problems.push(`${where}.${metric} is missing; it must be a number ≥ ${COVERAGE_FLOOR}`);
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
  const exclude = stringList(coverage['exclude']) ?? [];
  if (!include || include.length === 0) {
    problems.push('test.coverage.include must list the source globs to measure');
  } else {
    const matchesAny = (file: string, globs: string[]): boolean =>
      globs.some((glob) => picomatch.isMatch(file, glob, { dot: true }));
    for (const file of MUST_BE_COVERED) {
      if (!matchesAny(file, include)) problems.push(`test.coverage.include no longer covers ${file}`);
      else if (matchesAny(file, exclude)) problems.push(`test.coverage.exclude removes ${file} from coverage`);
    }
    if (isRecord(thresholds)) {
      for (const glob of include) {
        if (!isRecord(thresholds[glob])) {
          problems.push(`test.coverage.thresholds has no per-glob entry for '${glob}'`);
        }
      }
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

/** Every reason the repository falls below the coverage floor; empty when it holds. */
export function checkCoverageFloor(input: CoverageFloorInput): string[] {
  return [
    ...checkVitestCoverage(input.vitestConfig),
    ...(input.dartSource === undefined ? [] : checkDartThreshold(input.dartSource)),
  ];
}
