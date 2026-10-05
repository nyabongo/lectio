/**
 * The one PR comment for a gate run: a status table with a row per gate, then every finding
 * grouped by file and, within a file, by claim. Each finding repeats its rule statement and how
 * to fix it. The hidden marker `<!-- lectio-gates -->` lets the CI job (L-031) find and update the
 * same comment on every run.
 */
import type { GateReport } from './runner.ts';
import { skipReason } from './result.ts';
import type { GateResult, GateResultItem, GateStatus, Severity } from './result.ts';
import type { RuleBook } from './rules.ts';

/** The sticky-comment marker name (`markerComment(COMMENT_MARKER)` in `@lectio/providers`). */
export const COMMENT_MARKER = 'lectio-gates';
/** The hidden marker line at the top of every comment. */
export const COMMENT_MARKER_LINE = `<!-- ${COMMENT_MARKER} -->`;

/** GitHub rejects comment bodies above 65,536 characters; stay well below it. */
export const DEFAULT_MAX_COMMENT_LENGTH = 60_000;

export interface RenderOptions {
  /** Gate titles by id, for headings; unknown gates show their id. */
  readonly gates: readonly { readonly id: string; readonly title: string }[];
  readonly rules: RuleBook;
  readonly maxLength?: number;
}

const STATUS_LABEL: Readonly<Record<GateStatus, string>> = {
  pass: 'Pass',
  fail: 'Fail',
  flag: 'Needs review',
  skipped: 'Skipped',
};

const HEADLINE: Readonly<Record<GateStatus, string>> = {
  pass: 'all gates passed',
  fail: 'a gate failed',
  flag: 'needs review',
  skipped: 'no gate ran',
};

const SEVERITY_ORDER: readonly Severity[] = ['error', 'warning', 'info'];

/** Text that is safe inside a markdown line: no HTML, no line breaks. */
function inline(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\s+/g, ' ').trim();
}

function code(text: string): string {
  return `\`${text.replace(/`/g, "'").replace(/\s+/g, ' ')}\``;
}

function cell(text: string): string {
  return inline(text).replace(/\|/g, '\\|');
}

function plural(count: number, word: string): string {
  return `${String(count)} ${word}${count === 1 ? '' : 's'}`;
}

function summary(result: GateResult): string {
  if (result.status === 'skipped') return skipReason(result) ?? '';
  const counts = SEVERITY_ORDER.map(
    (severity) => [severity, result.items.filter((item) => item.severity === severity).length] as const,
  )
    .filter(([, count]) => count > 0)
    .map(([severity, count]) => plural(count, severity === 'info' ? 'note' : severity));
  return counts.length === 0 ? 'no findings' : counts.join(', ');
}

/** Compares claim ids so that `c2` sorts before `c10`. */
function compareClaims(a: string, b: string): number {
  return a.localeCompare(b, 'en', { numeric: true });
}

interface Located {
  readonly item: GateResultItem;
  readonly gateIndex: number;
  readonly gate: string;
}

function compareLocated(a: Located, b: Located): number {
  return (
    SEVERITY_ORDER.indexOf(a.item.severity) - SEVERITY_ORDER.indexOf(b.item.severity) ||
    a.gateIndex - b.gateIndex ||
    a.item.pointer.localeCompare(b.item.pointer) ||
    a.item.ruleId.localeCompare(b.item.ruleId)
  );
}

function findingLines(located: Located, gateTitle: string, rules: RuleBook): string[] {
  const { item } = located;
  const at = item.pointer === '' ? '' : ` at ${code(item.pointer)}`;
  const lines = [`- **${item.severity}** · ${code(item.ruleId)} (${inline(gateTitle)})${at}: ${inline(item.message)}`];
  const rule = rules.get(item.ruleId);
  if (rule !== undefined) lines.push(`  - Rule: ${inline(rule.statement)}`, `  - Fix: ${inline(rule.fix)}`);
  return lines;
}

/** Items grouped by `key`, in first-seen order. */
function groupBy<T>(items: readonly T[], key: (item: T) => string): [string, T[]][] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const name = key(item);
    const group = groups.get(name);
    if (group === undefined) groups.set(name, [item]);
    else group.push(item);
  }
  return [...groups];
}

/** Findings grouped by file (whole-PR findings first), then by claim; each group is a list of blocks. */
function findingSections(report: GateReport, options: RenderOptions): [string, ...string[]][] {
  const title = (gate: string): string => options.gates.find((entry) => entry.id === gate)?.title ?? gate;
  const located = report.results.flatMap((result, gateIndex) =>
    result.items.map((item): Located => ({ item, gateIndex, gate: result.gate })),
  );
  const byFile = groupBy(located, (entry) => entry.item.file ?? '').sort(([a], [b]) => (a < b ? -1 : 1));
  return byFile.map(([file, entries]) => {
    const blocks: [string, ...string[]] = [file === '' ? '#### Pull request' : `#### ${code(file)}`];
    const byClaim = groupBy(entries, (entry) => entry.item.claimId ?? '').sort(([a], [b]) => compareClaims(a, b));
    for (const [claim, claimEntries] of byClaim) {
      const heading = claim === '' ? (file === '' ? null : '**Whole file**') : `**Claim ${code(claim)}**`;
      const lines = claimEntries
        .sort(compareLocated)
        .flatMap((entry) => findingLines(entry, title(entry.gate), options.rules));
      blocks.push([...(heading === null ? [] : [heading, '']), ...lines].join('\n'));
    }
    return blocks;
  });
}

/** Renders the PR comment for `report`. Deterministic: the same report gives the same text. */
export function renderComment(report: GateReport, options: RenderOptions): string {
  const maxLength = options.maxLength ?? DEFAULT_MAX_COMMENT_LENGTH;
  const title = (gate: string): string => options.gates.find((entry) => entry.id === gate)?.title ?? gate;
  const head = [
    COMMENT_MARKER_LINE,
    `## Lectio gates: ${HEADLINE[report.status]}`,
    '',
    '| Gate | Status | Details |',
    '| --- | --- | --- |',
    ...report.results.map(
      (result) =>
        `| ${cell(title(result.gate))} (${code(result.gate)}) | ${STATUS_LABEL[result.status]} | ${cell(summary(result))} |`,
    ),
    '',
  ];
  const footer = [
    '',
    `<sub>Base ${code(report.base)} · head ${code(report.head)} · ${plural(report.changedFiles.length, 'changed file')}. ` +
      'Each finding names its rule; the fix says what to change.</sub>',
    '',
  ];
  const sections = findingSections(report, options);
  if (sections.length === 0) return [...head, 'No findings.', ...footer].join('\n');

  const body = ['### Findings', ''];
  const budget = maxLength - [...head, ...footer].join('\n').length - 200;
  let used = body.join('\n').length;
  let omitted = 0;
  for (const [heading = '', ...blocks] of sections) {
    let headed = false;
    for (const block of blocks) {
      const cost = block.length + 2 + (headed ? 0 : heading.length + 2);
      if (omitted === 0 && used + cost <= budget) {
        if (!headed) body.push(heading, '');
        body.push(block, '');
        used += cost;
        headed = true;
      } else {
        omitted += block.split('\n').filter((line) => line.startsWith('- ')).length;
      }
    }
  }
  if (omitted > 0) {
    body.push(`_${plural(omitted, 'more finding')} not shown (comment size limit); see the gates.json artifact._`, '');
  }
  return [...head, ...body.slice(0, -1), ...footer].join('\n');
}
