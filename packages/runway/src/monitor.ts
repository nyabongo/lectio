/**
 * The runway monitor: computes the runway and keeps one GitHub issue (marked
 * `<!-- lectio-runway -->`) in step with it. Over the threshold the issue is opened or updated
 * with the missing days; back under it, the same issue is updated and closed.
 */
import type { RunwayConfig } from '@lectio/config';
import type { ContentRepo } from '@lectio/content';
import type { GitHubClient, Issue } from '@lectio/providers';
import type { IsoDate } from '@lectio/shared';

import { computeRunway, isExceeded, missingPassages } from './runway.ts';
import type { RunwayReport } from './runway.ts';

/** The marker of the one runway issue (`<!-- lectio-runway -->`). */
export const RUNWAY_MARKER = 'lectio-runway';

export const RUNWAY_ISSUE_TITLE = 'Content runway: upcoming days lack approved notes';

export interface IssueContent {
  readonly title: string;
  readonly body: string;
}

function plural(n: number, word: string): string {
  return `${String(n)} ${word}${n === 1 ? '' : 's'}`;
}

function window(report: RunwayReport): string {
  return `${report.from} to ${report.to} (${plural(report.windowDays, 'day')})`;
}

/** The issue title and body for `report` against `config` (the marker is added by `upsertIssue`). */
export function renderIssue(report: RunwayReport, config: RunwayConfig): IssueContent {
  const count = report.days.length;
  const exceeded = isExceeded(report, config.maxMissingDays);
  const lines: string[] = [];
  if (exceeded) {
    lines.push(
      `**${plural(count, 'day')}** in the window ${window(report)} lack approved notes, ` +
        `more than the ${String(config.maxMissingDays)} allowed (\`runway.maxMissingDays\`).`,
      '',
      'Pages still show references and link-outs without notes. Run the research CLI locally ' +
        '(`npm run research`) and review the open PRs to extend the runway.',
    );
  } else {
    lines.push(
      `Recovered: ${plural(count, 'day')} in the window ${window(report)} lack approved notes, ` +
        `within the ${String(config.maxMissingDays)} allowed (\`runway.maxMissingDays\`). Closing.`,
    );
  }
  if (count > 0) {
    lines.push('', '| Date | Missing |', '| --- | --- |');
    for (const day of report.days) {
      const what =
        day.reason === 'no-calendar'
          ? 'no calendar entry (run `npm run calendar:build`)'
          : day.missing.map((key) => `\`${key}\``).join(', ');
      lines.push(`| ${day.date} | ${what} |`);
    }
    const keys = missingPassages(report);
    if (keys.length > 0) {
      lines.push('', `**Passages to research (${String(keys.length)}):** ${keys.map((k) => `\`${k}\``).join(', ')}`);
    }
  }
  lines.push('', '_Updated daily by the runway monitor (`.github/workflows/runway.yml`)._');
  return { title: RUNWAY_ISSUE_TITLE, body: lines.join('\n') };
}

export interface MonitorInput {
  readonly from: IsoDate;
  readonly config: RunwayConfig;
  readonly repo: ContentRepo;
  readonly github: GitHubClient;
}

export interface MonitorResult {
  readonly report: RunwayReport;
  readonly exceeded: boolean;
  readonly issue: Issue;
  /** `true` when `upsertIssue` created the issue on this run. */
  readonly created: boolean;
}

/**
 * Computes the runway and upserts the runway issue: open when the missing days exceed
 * `maxMissingDays`, closed otherwise.
 *
 * `GitHubClient` cannot look an issue up by marker without upserting it, so a healthy run with no
 * runway issue yet creates it already closed; every later run reuses that one issue.
 */
export async function runMonitor({ from, config, repo, github }: MonitorInput): Promise<MonitorResult> {
  const report = computeRunway({ from, windowDays: config.windowDays, repo });
  const exceeded = isExceeded(report, config.maxMissingDays);
  const { issue, created } = await github.upsertIssue(RUNWAY_MARKER, {
    ...renderIssue(report, config),
    state: exceeded ? 'open' : 'closed',
  });
  return { report, exceeded, issue, created };
}
