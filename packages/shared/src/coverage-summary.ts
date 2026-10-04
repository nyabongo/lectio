/**
 * Renders vitest's `coverage/coverage-summary.json` (json-summary reporter) as a
 * Markdown table for the CI job summary and PR descriptions.
 */
import { COVERAGE_FLOOR, COVERAGE_METRICS } from './coverage-floor.ts';

interface MetricSummary {
  total: number;
  covered: number;
  pct: number | 'Unknown';
}

function isMetric(value: unknown): value is MetricSummary {
  if (typeof value !== 'object' || value === null) return false;
  const metric = value as Record<string, unknown>;
  return typeof metric['total'] === 'number' && typeof metric['covered'] === 'number';
}

const LABELS = { lines: 'Lines', branches: 'Branches', functions: 'Functions', statements: 'Statements' };

/** Markdown table of the `total` block; throws if the summary has no totals. */
export function renderCoverageSummary(summary: unknown): string {
  const total = (summary as { total?: Record<string, unknown> } | null)?.total;
  if (typeof total !== 'object' || total === null) {
    throw new Error('coverage summary has no "total" block (is the json-summary reporter enabled?)');
  }
  const rows = COVERAGE_METRICS.map((metric) => {
    const value = total[metric];
    if (!isMetric(value)) throw new Error(`coverage summary has no "${metric}" totals`);
    // v8 reports 'Unknown' (or 100) when there is nothing to measure.
    const pct = typeof value.pct === 'number' ? value.pct : 100;
    const status = pct >= COVERAGE_FLOOR ? '✅' : '❌';
    return `| ${LABELS[metric]} | ${pct.toFixed(2)}% | ${value.covered}/${value.total} | ${status} |`;
  });
  return [
    `### Unit coverage (floor ${COVERAGE_FLOOR}%)`,
    '',
    '| Metric | Coverage | Covered/Total | ≥ floor |',
    '| --- | ---: | ---: | :---: |',
    ...rows,
    '',
  ].join('\n');
}
