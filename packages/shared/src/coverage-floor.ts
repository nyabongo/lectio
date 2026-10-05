/**
 * The 96% coverage floor, checked against the configuration itself rather than
 * a coverage run: `npm run coverage:floor` (scripts/check-coverage-floor.mjs)
 * fails if anyone lowers a vitest threshold (or sets it to a non-number), drops
 * or rewrites one of the canonical `coverage.include` globs, adds anything to
 * `coverage.exclude` beyond the four allowed globs, or lowers the Dart threshold
 * in `apps/mobile/tool/check_coverage.dart`.
 *
 * Guarded by CODEOWNERS together with vitest.config.ts.
 */
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

/** Every reason the repository falls below the coverage floor; empty when it holds. */
export function checkCoverageFloor(input: CoverageFloorInput): string[] {
  return [
    ...checkVitestCoverage(input.vitestConfig),
    ...(input.dartSource === undefined ? [] : checkDartThreshold(input.dartSource)),
  ];
}
