/**
 * Generates docs/gates.md (`npm run gates:docs`, L-043) from `gates.template.md` and the code:
 * the gate registry and its rules, the runner's rules, the merge-rule decisions and labels, the
 * config defaults the rules read, the licence-guard limitation (textguard's `LIMITATION`, L-013)
 * and a sample PR comment rendered by the real merge rule and renderer (./sample.ts).
 *
 * The template holds the prose; each `<!-- generated:<name> -->` line in it is replaced by one
 * generated block. The result is formatted with the repository's Prettier config, so
 * `npm run format:check` and the docs-in-sync test agree on the exact text.
 */
import { readFileSync } from 'node:fs';

import { DEFAULT_CONFIG } from '@lectio/config';
import type { LectioConfig } from '@lectio/config';
import { format, resolveConfig } from 'prettier';

import { DECISION_LABELS, labelFor } from '../ci/merge-rule-job.ts';
import { RUNNER_RULES } from '../core/rules.ts';
import type { Rule } from '../core/rules.ts';
import type { Gate } from '../core/gate.ts';
import { LIMITATION } from '../licence-gate/index.ts';
import { DECISIONS, GREEN_DECISIONS, PROTECTED_PATH_PREFIXES } from '../merge-rule/index.ts';
import type { Decision } from '../merge-rule/index.ts';
import { GATES } from '../registry.ts';
import { sampleComment } from './sample.ts';

/** The template next to this file. */
export const TEMPLATE_URL = new URL('./gates.template.md', import.meta.url);
/** Where the generated file lives, relative to the repository root. */
export const GATES_DOC_PATH = 'docs/gates.md';

/** What each gate is for, in one or two sentences (the rules say the rest). */
export const GATE_SUMMARIES: Readonly<Record<string, { readonly kind: string; readonly summary: string }>> = {
  schema: {
    kind: 'deterministic',
    summary:
      'Every changed passage, translation and calendar file is valid, well keyed and fully cited: each sentence ' +
      'ends in a claim marker, each claim names a source, nothing is orphaned and approvals are well formed.',
  },
  evidence: {
    kind: 'deterministic',
    summary:
      'The cited evidence exists: web excerpts are found on the fetched page, scripture excerpts and original-language ' +
      'words occur in the corpus at that verse. Print sources cannot be checked, so they are flagged for a person.',
  },
  licence: {
    kind: 'deterministic',
    summary:
      'No long verbatim run from an English Bible or a cited commentary: quoted spans, overlap with the public-domain ' +
      'Bible index, overlap with each fetched web source and excerpt length all have limits. Translations are scanned ' +
      'too, against the English passage’s sources; their main safeguard is the mandatory human review.',
  },
  verifiers: {
    kind: 'LLM, trusted side only',
    summary:
      'Two models from different families see only the claims and their sources: the confirmer checks support, the ' +
      'refuter tries to refute. Each gives a verdict and a support score per claim.',
  },
  'merge-rule': {
    kind: 'decision',
    summary:
      'Reads the other gates’ results, the config and the facts of the PR (approvals, approval commits, paths, fork) ' +
      'and decides one of the decisions below. It never closes a PR.',
  },
};

/** What each decision means and what happens next. */
export const DECISION_TEXT: Readonly<Record<Decision, string>> = {
  blocked:
    'A deterministic gate failed, a changed file is a symbolic link or submodule, an approval commit is forged, or ' +
    'the PR sets a review block to approved by hand. Nothing merges until the author pushes a fix.',
  'approved-commit':
    'The head is a valid approval commit written by the merge-rule job. The `merge` job waits for every required ' +
    'check on it and squash-merges.',
  'human-approved':
    'A configured reviewer added the approval label or commented the approval command after the last content ' +
    'commit. The job writes the review block in an approval commit, which is then decided as `approved-commit`.',
  'auto-merge':
    'Every gate passed and both verifiers support every claim at `autoMerge.minSupport` or higher, with no ' +
    'refutation and no review condition. The job writes an `auto` review block in an approval commit.',
  'needs-review':
    'Anything else: a flag, low support, a refutation, a sensitive claim, a skipped verifier, a protected path, a ' +
    'translation, a fork PR, files outside `passages/`. The PR waits for a person; it is never closed.',
};

/** Escapes text for a markdown table cell. */
function cell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
}

function ruleLines(rule: Rule): string[] {
  return [`- **\`${rule.id}\`**: ${rule.statement}`, `  - Fix: ${rule.fix}`];
}

function overview(gates: readonly Gate[]): string {
  const rows = gates.map((gate, index) => {
    const about = GATE_SUMMARIES[gate.id];
    if (about === undefined) throw new RangeError(`docs: no summary for gate "${gate.id}" in GATE_SUMMARIES`);
    return `| ${String(index + 1)} | ${gate.title} (\`${gate.id}\`) | ${about.kind} | ${String(gate.rules.length)} | ${cell(about.summary)} |`;
  });
  return ['| # | Gate | Kind | Rules | What it checks |', '| --- | --- | --- | --- | --- |', ...rows].join('\n');
}

function rules(gates: readonly Gate[]): string {
  const sections = gates.map((gate, index) =>
    [`### ${String(index + 1)}. ${gate.title} (\`${gate.id}\`)`, '', ...gate.rules.flatMap(ruleLines)].join('\n'),
  );
  const runner = [
    '### The runner (`runner`)',
    '',
    'The runner reports these itself when a gate cannot be trusted to report.',
    '',
    ...Object.values(RUNNER_RULES).flatMap(ruleLines),
  ].join('\n');
  return [...sections, runner].join('\n\n');
}

function decisions(): string {
  const rows = DECISIONS.map((decision) => {
    const green = GREEN_DECISIONS.has(decision) ? 'green' : 'red';
    return `| \`${decision}\` | ${green} | \`${labelFor(decision, false)}\` | ${cell(DECISION_TEXT[decision])} |`;
  });
  return [
    '| Decision | `merge-rule` check | Label | Meaning |',
    '| --- | --- | --- | --- |',
    ...rows,
    '',
    `The job keeps exactly one of ${DECISION_LABELS.map((label) => `\`${label}\``).join(', ')} on the PR.`,
    `A green decision on a PR that must be merged by hand (it changes \`.github/**\`) gets \`${labelFor('auto-merge', true)}\`.`,
  ].join('\n');
}

function configTable(config: LectioConfig): string {
  const entries: [string, unknown][] = [
    ...Object.entries(config.autoMerge).map(([key, value]): [string, unknown] => [`autoMerge.${key}`, value]),
    ...Object.entries(config.reviewer).map(([key, value]): [string, unknown] => [`reviewer.${key}`, value]),
    ...Object.entries(config.licenceGuard).map(([key, value]): [string, unknown] => [`licenceGuard.${key}`, value]),
  ];
  return [
    '| Key | Default |',
    '| --- | --- |',
    ...entries.map(([key, value]) => `| \`${key}\` | \`${JSON.stringify(value)}\` |`),
  ].join('\n');
}

function limitation(): string {
  return LIMITATION.split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
}

function protectedPaths(): string {
  return PROTECTED_PATH_PREFIXES.map((prefix) => `\`${prefix}**\``).join(', ');
}

function comment(config: LectioConfig): string {
  // `text`, not `markdown`: Prettier would reformat a markdown block, and the docs show the exact text.
  return ['````text', sampleComment(config).trimEnd(), '````'].join('\n');
}

/** The generated blocks, by placeholder name. */
export function generatedBlocks(
  gates: readonly Gate[] = GATES,
  config: LectioConfig = DEFAULT_CONFIG,
): Readonly<Record<string, string>> {
  return {
    overview: overview(gates),
    rules: rules(gates),
    decisions: decisions(),
    config: configTable(config),
    limitation: limitation(),
    'protected-paths': protectedPaths(),
    'sample-comment': comment(config),
  };
}

const PLACEHOLDER = /<!-- generated:([a-z-]+) -->/g;
/** The template's own header comment, which the generated file leaves out. */
const TEMPLATE_HEADER = /^<!-- template:[\s\S]*?-->\n+/;

/**
 * Drops the template's header comment and replaces every placeholder in `template`; throws on an
 * unknown or unused block.
 */
export function fillTemplate(template: string, blocks: Readonly<Record<string, string>>): string {
  const used = new Set<string>();
  const filled = template.replace(TEMPLATE_HEADER, '').replace(PLACEHOLDER, (_line, name: string) => {
    const block = blocks[name];
    if (block === undefined) throw new RangeError(`docs: unknown placeholder "${name}" in the template`);
    used.add(name);
    return block;
  });
  const unused = Object.keys(blocks).filter((name) => !used.has(name));
  if (unused.length > 0) throw new RangeError(`docs: the template never uses ${unused.join(', ')}`);
  return filled;
}

export interface RenderGatesDocOptions {
  /** Defaults to `gates.template.md` next to this file. */
  readonly template?: string;
  readonly gates?: readonly Gate[];
  readonly config?: LectioConfig;
  /** The path Prettier resolves its config for (defaults to the template's path). */
  readonly filepath?: string;
}

/** The full text of docs/gates.md, formatted with the repository's Prettier config. */
export async function renderGatesDoc(options: RenderGatesDocOptions = {}): Promise<string> {
  const template = options.template ?? readFileSync(TEMPLATE_URL, 'utf8');
  const source = fillTemplate(template, generatedBlocks(options.gates, options.config));
  const filepath = options.filepath ?? TEMPLATE_URL.pathname;
  const prettier = await resolveConfig(filepath);
  return format(source, { ...prettier, parser: 'markdown', filepath });
}
