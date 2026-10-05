/** Plain-text report of a back-fill estimate. */
import type { BackfillEstimate } from './estimate.ts';

/** How many of the next keys the estimate lists. */
export const PREVIEW_KEYS = 10;

const money = (usd: number): string => `$${usd.toFixed(2)}`;

function yearRange(from: number, to: number): string {
  return from === to ? String(from) : `${String(from)}–${String(to)}`;
}

function ceilingLine(estimate: BackfillEstimate): string {
  const { ceilingUsd, ceilingCovers, remaining, estimatedUsd, spentUsd, leftUsd } = estimate;
  if (ceilingUsd <= 0) {
    return `Back-fill ceiling: ${money(0)} (research.budget.backfillTotalUsd): estimate only, nothing is generated.`;
  }
  const name = `Back-fill ceiling: ${money(ceilingUsd)} (research.budget.backfillTotalUsd): `;
  if (spentUsd === null || leftUsd === null) {
    return `${name}spent so far unknown (the spend ledger does not read), so what is left is unknown too.`;
  }
  const head = `${name}${money(spentUsd)} spent so far, ${money(leftUsd)} left; `;
  // Under a cent cannot pay for a research call (./ledger.ts refuses the batch).
  if (leftUsd < 0.01) return `${head}used up, nothing more is generated.`;
  const covers = ceilingCovers === null || ceilingCovers >= remaining.length;
  return (
    head +
    (covers
      ? 'covers every remaining passage.'
      : `covers ${String(ceilingCovers)} of ${String(remaining.length)} passages; ` +
        `${money(estimatedUsd - leftUsd)} short.`)
  );
}

/** The estimate: key counts, cost, ceiling, batches and the next keys in order. */
export function formatEstimate(estimate: BackfillEstimate): string {
  const { remaining } = estimate;
  const source = estimate.perPassageSource === 'measured' ? 'measured average' : 'research.budget.perPassageUsd';
  const lines = [
    `Back-fill estimate for ${yearRange(estimate.fromYear, estimate.toYear)} as of ${estimate.today}`,
    `Passage keys: ${String(estimate.totalKeys)} in the calendars, ${String(estimate.existing)} already written, ` +
      `${String(remaining.length)} to research`,
    `Estimated cost: ${money(estimate.estimatedUsd)} (${String(remaining.length)} × ` +
      `${money(estimate.perPassageUsd)} per passage, ${source})`,
    ceilingLine(estimate),
    estimate.batches === null
      ? 'Batches: none possible (reviewer capacity or the run budget is 0)'
      : `Batches: ${String(estimate.batches)} of at most ${String(estimate.batchSize)} passages ` +
        '(reviewer capacity, weekly intake and research.budget.perRunUsd)' +
        (estimate.weeks === null ? '' : `, about ${String(estimate.weeks)} week(s) of reviewer intake`),
  ];
  if (estimate.missingYears.length > 0) {
    lines.push(`No calendar for ${estimate.missingYears.map(String).join(', ')}: those years are not counted.`);
  }
  if (estimate.lectionaryMissingDays > 0) {
    lines.push(`Lectionary data missing for ${String(estimate.lectionaryMissingDays)} day(s): not counted.`);
  }
  if (remaining.length > 0) {
    const shown = remaining.slice(0, PREVIEW_KEYS);
    lines.push('', `Next ${String(shown.length)} in back-fill order:`);
    for (const entry of shown) {
      const when = entry.nextDate ?? `${entry.firstDate} (past)`;
      lines.push(`  ${when}  ${entry.key}  (${entry.ref})`);
    }
    if (remaining.length > shown.length) lines.push(`  … and ${String(remaining.length - shown.length)} more`);
  }
  return lines.join('\n');
}
