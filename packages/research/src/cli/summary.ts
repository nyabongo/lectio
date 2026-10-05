/** The end-of-run report: the plan, the pre-validation section and a table of cost, outcome and PR per passage. */
import { formatPlan } from '../plan/format.ts';
import { formatValidationReport } from '../validate/validate.ts';
import type { RunReport, SummaryRow } from './run.ts';

const money = (usd: number): string => `$${usd.toFixed(2)}`;

/** A plain-text table with left-aligned columns. */
export function table(header: readonly string[], rows: readonly (readonly string[])[]): string {
  const widths = header.map((title, column) =>
    Math.max(title.length, ...rows.map((row) => (row[column] ?? '').length)),
  );
  const line = (cells: readonly string[]): string =>
    cells
      .map((cell, column) => cell.padEnd(widths[column] ?? 0))
      .join('  ')
      .trimEnd();
  return [line(header), line(widths.map((width) => '-'.repeat(width))), ...rows.map(line)].join('\n');
}

function cells(row: SummaryRow): string[] {
  return [row.key, row.research, row.validation ?? '-', money(row.costUsd), row.pr];
}

/** The summary table and totals of a run. */
export function formatSummary(report: RunReport): string {
  const header = ['Passage', 'Research', 'Validation', 'Cost', 'PR'];
  const problems = report.rows.filter((row) => row.problem).length;
  return [
    `Run ${report.runId}${report.dryRun ? ' (dry run: nothing was published)' : ''}`,
    report.rows.length === 0 ? 'Nothing to research.' : table(header, report.rows.map(cells)),
    `Spent ${money(report.spentUsd)} of the ${money(report.ceilingUsd)} run budget.` +
      (problems === 0 ? '' : ` ${String(problems)} passage(s) need attention.`),
  ].join('\n');
}

/** Everything `research run` prints. */
export function formatRunReport(report: RunReport): string {
  return [
    formatPlan(report.plan).trimEnd(),
    ...report.closed.map((entry) => `Skipped ${entry.key}: a person closed PR #${String(entry.pr)}`),
    '',
    formatValidationReport(report.validation),
    '',
    formatSummary(report),
  ].join('\n');
}
