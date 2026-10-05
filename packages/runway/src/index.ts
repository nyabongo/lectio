/**
 * @lectio/runway: the content runway monitor.
 *
 * `computeRunway({ from, windowDays, repo })` lists the days in the window where any reading
 * lacks an approved note, with the missing passage keys. `runMonitor` keeps one GitHub issue
 * (marker `<!-- lectio-runway -->`) open while the missing days exceed `runway.maxMissingDays`
 * and closes it once they are back within it. `npm run runway` runs it (daily in
 * `.github/workflows/runway.yml`).
 */
export const packageName = '@lectio/runway';

export { RUNWAY_ISSUE_TITLE, RUNWAY_MARKER, renderIssue, runMonitor } from './monitor.ts';
export type { IssueContent, MonitorInput, MonitorResult } from './monitor.ts';
export { USAGE, parseArgs, processContext, runRunway } from './run.ts';
export type { CliArgs, CliContext, CliIo } from './run.ts';
export { computeRunway, isExceeded, missingPassages } from './runway.ts';
export type { MissingDay, MissingReason, RunwayInput, RunwayReport } from './runway.ts';
