/**
 * The text of a research PR: its title, the commit message with the attribution trailer, and the
 * PR body (passage summary, reference, dates, claim and source counts, cost, models, prompt
 * version, a gate checklist placeholder and the reviewer checklist explaining how to approve).
 */
import type { ReviewerConfig } from '@lectio/config';
import type { Passage } from '@lectio/schema/passage';

/** Trailer key on every research commit: `Lectio-Research: key=<key> run=<run id> prompt=<version> models=<ids>`. */
export const RESEARCH_TRAILER = 'Lectio-Research';

/** Marker comment prefix in the PR body; it records the key and the hash of the committed files. */
export const BODY_MARKER = 'lectio-research';

/** Gate slugs, in run order (see `@lectio/schema/gate-result`). */
export const GATE_SLUGS = ['schema', 'evidence', 'licence', 'verifiers', 'merge-rule'] as const;

/** Start and end markers around the gate checklist, so the content-gates workflow can replace it. */
export const GATES_START = '<!-- lectio-gates:start -->';
export const GATES_END = '<!-- lectio-gates:end -->';

const GATE_NAMES: Readonly<Record<(typeof GATE_SLUGS)[number], string>> = {
  schema: 'Schema: the passage file validates and its references parse',
  evidence: 'Evidence: every claim has a fetchable or citable source',
  licence: 'Licence: no reading text and no over-long quotation',
  verifiers: 'Verifiers: two model families check every claim',
  'merge-rule': 'Merge rule: auto-merge or wait for a person',
};

/** What the body describes; everything else comes from the passage itself. */
export interface PrTextInput {
  readonly passage: Passage;
  /** Repository path of the passage file. */
  readonly path: string;
  /** Calendar dates of the passage in the run's window, ascending. */
  readonly dates: readonly string[];
  /** Run cost of this passage; defaults to `provenance.costUsd`. */
  readonly costUsd?: number;
  /** sha256 of the committed files, recorded in the body marker. */
  readonly contentHash: string;
  readonly reviewer: Pick<ReviewerConfig, 'githubHandles' | 'approvalLabel' | 'approvalCommand'>;
}

/**
 * Model or LLM text made safe for one line of Markdown: whitespace collapsed, HTML and Markdown
 * control characters escaped, and `@` and `#` kept from pinging people or linking issues.
 */
export function inline(text: string): string {
  return text
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/([\\`*_[\]|~])/gu, '\\$1')
    .replace(/([@#])/gu, '$1​');
}

/** A value for a code span: backticks dropped, whitespace collapsed. */
function code(text: string): string {
  return `\`${text.replace(/`/gu, '').replace(/\s+/gu, ' ').trim()}\``;
}

const list = (values: readonly string[], empty: string): string =>
  values.length === 0 ? empty : values.map(code).join(', ');

export function prTitle(passage: Pick<Passage, 'key' | 'ref'>): string {
  return `Research: ${passage.ref.replace(/\s+/gu, ' ').trim()} (${passage.key})`;
}

/** The commit message: a subject line, the summary, and the attribution trailer. */
export function commitMessage(passage: Passage): string {
  const { provenance } = passage;
  const token = (value: string): string => value.trim().replace(/\s+/gu, '_');
  const trailer = [
    `key=${passage.key}`,
    `run=${token(provenance.runId)}`,
    `prompt=${token(provenance.promptVersion)}`,
    `models=${provenance.models.length === 0 ? 'none' : provenance.models.map(token).join(',')}`,
  ].join(' ');
  return [
    `Research ${passage.key} (${passage.ref.replace(/\s+/gu, ' ').trim()})`,
    '',
    passage.summary.replace(/\s+/gu, ' ').trim(),
    '',
    `${RESEARCH_TRAILER}: ${trailer}`,
  ].join('\n');
}

/** The marker comment carrying the key and content hash. */
export function bodyMarker(key: string, contentHash: string): string {
  return `<!-- ${BODY_MARKER} key=${key} sha256=${contentHash} -->`;
}

/** The content hash recorded in a PR body, or `null` when the body has no marker for `key`. */
export function hashInBody(body: string, key: string): string | null {
  const prefix = `<!-- ${BODY_MARKER} key=${key} sha256=`;
  const start = body.lastIndexOf(prefix);
  if (start < 0) return null;
  const match = /^([0-9a-f]{64}) -->/u.exec(body.slice(start + prefix.length));
  return match?.[1] ?? null;
}

function count(n: number, noun: string): string {
  return `${String(n)} ${noun}${n === 1 ? '' : 's'}`;
}

function sourceBreakdown(sources: Passage['sources']): string {
  const byType = new Map<string, number>();
  for (const source of sources) byType.set(source.type, (byType.get(source.type) ?? 0) + 1);
  const parts = [...byType].map(([type, n]) => `${String(n)} ${type}`);
  return parts.length === 0 ? '' : ` (${parts.join(', ')})`;
}

export function prBody(input: PrTextInput): string {
  const { passage, reviewer } = input;
  const { provenance } = passage;
  const sensitive = passage.claims.filter((claim) => claim.sensitive).length;
  const cost = input.costUsd ?? provenance.costUsd;
  const rows: [string, string][] = [
    ['Reference', inline(passage.ref)],
    ['Passage key', code(passage.key)],
    ['Dates', input.dates.length === 0 ? 'none in this run' : input.dates.join(', ')],
    ['Claims', `${String(passage.claims.length)} (${String(sensitive)} sensitive)`],
    ['Sources', `${String(passage.sources.length)}${sourceBreakdown(passage.sources)}`],
    ['Translation notes', String(passage.translationNotes.length)],
    ['Cost', cost === undefined ? 'not recorded' : `$${cost.toFixed(2)}`],
    ['Models', list(provenance.models, 'none')],
    ['Prompt version', code(provenance.promptVersion)],
    ['Run', code(provenance.runId)],
    ['File', code(input.path)],
  ];
  const handles = list(reviewer.githubHandles, 'none configured yet');
  return [
    `## ${inline(passage.ref)}: ${inline(passage.context.title)}`,
    '',
    `> ${inline(passage.summary)}`,
    '',
    '| | |',
    '| --- | --- |',
    ...rows.map(([name, value]) => `| ${name} | ${value} |`),
    '',
    '### Gates',
    '',
    GATES_START,
    ...GATE_SLUGS.map((slug) => `- [ ] ${GATE_NAMES[slug]}`),
    '',
    '_Placeholder: the content-gates workflow reports each gate on this PR._',
    GATES_END,
    '',
    '### Reviewer checklist',
    '',
    `- [ ] Every claim (${count(passage.claims.length, 'claim')}) is supported by the sources it cites`,
    `- [ ] Sensitive claims (${String(sensitive)}) are stated fairly and carefully`,
    '- [ ] Translation notes match the original-language words',
    '- [ ] No English Bible text is quoted: commentary, references and original-language words only',
    '',
    `**How to approve.** A reviewer listed in \`reviewer.githubHandles\` (${handles}) adds the ` +
      `${code(reviewer.approvalLabel)} label or comments ${code(reviewer.approvalCommand)}. ` +
      'Approval counts only after the last content commit: a new commit (for example a research fix-up) resets it. ' +
      'If every gate passes with high confidence the merge rule may merge without a person. ' +
      'A failed or uncertain gate never closes this PR; it waits for review.',
    '',
    `_Opened by the Lectio research CLI. Re-running research for ${code(passage.key)} updates this PR._`,
    '',
    bodyMarker(passage.key, input.contentHash),
    '',
  ].join('\n');
}
