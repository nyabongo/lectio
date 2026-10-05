/** A plain-text report of a plan, for `research plan` and dry runs. */
import type { Plan, SkippedItem } from './plan.ts';

function skipNote(item: SkippedItem): string {
  switch (item.reason) {
    case 'exists':
      return 'passage file exists';
    case 'open-pr':
      return `open PR #${String(item.pr)}`;
    case 'capacity':
      return 'reviewer capacity reached';
    case 'budget':
      return 'run budget reached';
    case 'max':
      return '--max reached';
  }
}

function dateList(dates: readonly string[]): string {
  return dates.length <= 5 ? dates.join(', ') : `${dates.slice(0, 5).join(', ')} and ${String(dates.length - 5)} more`;
}

export function formatPlan(plan: Plan): string {
  const { capacity, budget } = plan;
  const lines = [
    `Research plan ${plan.from} to ${plan.to} (${String(plan.days)} days)`,
    `Reviewer capacity: ${String(capacity.openReviewPrs)} of ${String(capacity.maxOpenReviewPrs)} review PRs open, room for ${String(capacity.available)}`,
    `Budget: $${budget.perPassageUsd.toFixed(2)} per passage, $${budget.perRunUsd.toFixed(2)} per run` +
      (budget.affordable === null ? '' : `, room for ${String(budget.affordable)}`),
    '',
    `To research (${String(plan.items.length)}, estimated $${budget.estimatedUsd.toFixed(2)}):`,
    ...(plan.items.length === 0
      ? ['  (none)']
      : plan.items.map((item) => `  ${item.firstDate}  ${item.key}  (${item.ref})`)),
  ];
  if (plan.skipped.length > 0) {
    lines.push('', `Skipped (${String(plan.skipped.length)}):`);
    lines.push(...plan.skipped.map((item) => `  ${item.firstDate}  ${item.key}  ${skipNote(item)}`));
  }
  if (plan.limitedBy !== null) lines.push('', `Limited by ${plan.limitedBy}: at most ${String(plan.limit)} this run.`);
  for (const key of plan.unscheduled) lines.push('', `Not in any calendar from ${plan.from}: ${key}`);
  if (plan.missingDates.length > 0) {
    lines.push('', `No calendar day for ${String(plan.missingDates.length)} date(s): ${dateList(plan.missingDates)}`);
  }
  if (plan.lectionaryMissingDates.length > 0) {
    lines.push(
      '',
      `Lectionary data missing for ${String(plan.lectionaryMissingDates.length)} date(s): ${dateList(plan.lectionaryMissingDates)}`,
    );
  }
  return `${lines.join('\n')}\n`;
}
