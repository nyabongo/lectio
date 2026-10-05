/**
 * Pre-validation (L-036): the research CLI only opens pull requests that already pass the
 * deterministic gates.
 *
 * Each draft is assembled and run through gates 1–3 in-process. While it fails, the failure
 * messages go back to the `repair` model for up to `research.maxRepairs` revisions. If it still
 * fails, only the failing claims and notes are dropped when the rest stays valid; otherwise the
 * draft is abandoned with a report. The outcome is `ready`, `ready-with-drops` or `abandoned`.
 */
import { join } from 'node:path';

import type { LectioConfig } from '@lectio/config';
import { ContentError, formatIssue } from '@lectio/content';
import type { GateReport } from '@lectio/gates';
import { BudgetExceededError, LlmOutputError, ProviderError, validateAgainstSchema } from '@lectio/providers';
import type { CostMeter, LlmClient, LlmTool } from '@lectio/providers';
import type { Passage } from '@lectio/schema/passage';

import { assemblePassage } from '../agent/assemble.ts';
import type { AssembleMeta } from '../agent/assemble.ts';
import { prettierJson } from '../agent/research.ts';
import type { FailedResult, WrittenResult } from '../agent/research.ts';
import { RESEARCH_RESPONSE_SCHEMA } from '../agent/schema.ts';
import type { ResearchOutput } from '../agent/schema.ts';
import { applyDrops, planDrops } from './drop.ts';
import type { DropTarget } from './drop.ts';
import { draftPath, runDraftGates } from './gates.ts';
import type { DraftGateDeps } from './gates.ts';
import { REPAIR_PROMPT_VERSION, buildRepairRequest } from './prompt.ts';

export type ValidationOutcome = 'ready' | 'ready-with-drops' | 'abandoned';

/** Everything the assembler needs besides the output; `costUsd` is what research spent before validation. */
export type DraftMeta = Omit<AssembleMeta, 'key' | 'ref'>;

/** One draft to validate: the model's research output for a passage. */
export interface Draft {
  readonly key: string;
  readonly ref: string;
  /** The research output (parsed JSON, or raw text when the model did not return valid JSON). */
  readonly output: unknown;
  readonly meta: DraftMeta;
}

export interface ValidateDeps extends DraftGateDeps {
  /** The client for `repair` calls; it should charge {@link ValidateDeps.meter}. */
  readonly llm: LlmClient;
  readonly config: LectioConfig;
  /** What repairs spend is read here and added to the draft's research cost in the provenance. */
  readonly meter?: CostMeter;
  /** Default `config.research.maxRepairs`. */
  readonly maxRepairs?: number;
  readonly tools?: readonly LlmTool[];
  readonly maxTokens?: number;
  /** Formats the passage JSON the way the repository's Prettier check expects. Default Prettier. */
  readonly format?: (json: string, path: string) => Promise<string>;
}

/** Why an attempt did not reach the gates, or what the gates said. */
export type AttemptStage = 'invalid-json' | 'invalid-output' | 'invalid-passage' | 'gates-failed' | 'passed';

export interface Attempt {
  /** 0 for the research draft, n for the draft after repair n. */
  readonly attempt: number;
  readonly stage: AttemptStage;
  readonly problems: readonly string[];
}

interface ResultBase {
  readonly key: string;
  /** Repair calls made (each counts against `research.maxRepairs`). */
  readonly repairs: number;
  readonly attempts: readonly Attempt[];
  /** Why repairing stopped before `maxRepairs`, when a repair call failed (budget, provider error). */
  readonly repairStopped?: string;
  /** What repairs spent, in USD (0 without a meter). */
  readonly repairCostUsd: number;
}

export interface ReadyValidation extends ResultBase {
  readonly outcome: 'ready';
  readonly passage: Passage;
  /** The formatted file the gates passed: write it to `path` as is. */
  readonly text: string;
  /** Repository-relative path, `passages/<key>.json` under the content root. */
  readonly path: string;
  readonly report: GateReport;
}

export interface ReadyWithDropsValidation extends Omit<ReadyValidation, 'outcome'> {
  readonly outcome: 'ready-with-drops';
  /** What was removed and why. */
  readonly dropped: readonly DropTarget[];
}

export interface AbandonedValidation extends ResultBase {
  readonly outcome: 'abandoned';
  readonly reason: string;
  /** The problems that remain, one per entry. */
  readonly problems: readonly string[];
  /** The last gate report, when a draft reached the gates. */
  readonly report?: GateReport;
}

export type ValidationResult = ReadyValidation | ReadyWithDropsValidation | AbandonedValidation;

type Evaluation =
  | { readonly stage: Exclude<AttemptStage, 'gates-failed' | 'passed'>; readonly problems: readonly string[] }
  | {
      readonly stage: 'gates-failed' | 'passed';
      readonly problems: readonly string[];
      readonly passage: Passage;
      readonly text: string;
      readonly run: Awaited<ReturnType<typeof runDraftGates>>;
    };

type Gated = Extract<Evaluation, { readonly passage: Passage }>;

/** The model output as a value, or the reason it is not JSON. */
function parsed(output: unknown): { readonly value: unknown } | { readonly problem: string } {
  if (typeof output !== 'string') return { value: output };
  try {
    return { value: JSON.parse(output) as unknown };
  } catch (error) {
    return { problem: `the output is not valid JSON (${(error as Error).message})` };
  }
}

/** Pre-validates one draft: gates, repairs, drops. Unexpected (programming) errors are rethrown. */
export async function preValidate(draft: Draft, deps: ValidateDeps): Promise<ValidationResult> {
  const maxRepairs = deps.maxRepairs ?? deps.config.research.maxRepairs;
  const path = draftPath(deps.config, draft.key);
  const format = deps.format ?? prettierJson;
  const repairCost = (): number => deps.meter?.spentUsd() ?? 0;
  const models = [...draft.meta.models];
  let fake = draft.meta.family === 'fake';

  const gate = async (passage: Passage): Promise<Gated> => {
    const text = await format(`${JSON.stringify(passage, null, 2)}\n`, join(deps.root, path));
    const run = await runDraftGates(path, text, deps);
    return { stage: run.passed ? 'passed' : 'gates-failed', problems: run.problems, passage, text, run };
  };

  const evaluate = async (output: unknown): Promise<Evaluation> => {
    const value = parsed(output);
    if ('problem' in value) return { stage: 'invalid-json', problems: [value.problem] };
    const schemaProblems = validateAgainstSchema(RESEARCH_RESPONSE_SCHEMA, value.value);
    if (schemaProblems.length > 0) return { stage: 'invalid-output', problems: schemaProblems };
    let passage: Passage;
    try {
      passage = assemblePassage(value.value as ResearchOutput, {
        ...draft.meta,
        key: draft.key,
        ref: draft.ref,
        models,
        family: fake ? 'fake' : draft.meta.family,
        costUsd: draft.meta.costUsd + repairCost(),
      });
    } catch (error) {
      if (!(error instanceof ContentError)) throw error;
      return { stage: 'invalid-passage', problems: error.issues.map((issue) => formatIssue(error.file, issue)) };
    }
    return gate(passage);
  };

  const attempts: Attempt[] = [];
  let output = draft.output;
  let repairs = 0;
  let repairStopped: string | undefined;
  let last: Evaluation;
  let lastGated: Gated | undefined;
  const base = (): ResultBase => ({
    key: draft.key,
    repairs,
    attempts,
    ...(repairStopped === undefined ? {} : { repairStopped }),
    repairCostUsd: repairCost(),
  });

  for (;;) {
    last = await evaluate(output);
    attempts.push({ attempt: repairs, stage: last.stage, problems: last.problems });
    if ('passage' in last) {
      lastGated = last;
      if (last.stage === 'passed') {
        return { ...base(), outcome: 'ready', passage: last.passage, text: last.text, path, report: last.run.report };
      }
    }
    if (repairs >= maxRepairs) break;
    const request = buildRepairRequest(
      { key: draft.key, ref: draft.ref, output, problems: last.problems, attempt: repairs + 1 },
      {
        config: deps.config,
        ...(deps.tools === undefined ? {} : { tools: deps.tools }),
        ...(deps.maxTokens === undefined ? {} : { maxTokens: deps.maxTokens }),
      },
    );
    try {
      const response = await deps.llm.generate(request);
      repairs += 1;
      output = response.output;
      models.push(response.model);
      fake ||= response.family === 'fake';
    } catch (error) {
      if (error instanceof LlmOutputError) {
        // Malformed after the client's own retries: the next attempt reports it and the model sees its text.
        repairs += 1;
        output = error.rawText;
        continue;
      }
      if (error instanceof BudgetExceededError) {
        repairs += 1; // the call was made and charged
        repairStopped = `budget: ${error.message}`;
        break;
      }
      if (error instanceof ProviderError) {
        repairStopped = `${error.code}: ${error.message}`;
        break;
      }
      throw error;
    }
  }

  if (lastGated === undefined) {
    return {
      ...base(),
      outcome: 'abandoned',
      reason: 'no draft could be assembled into a valid passage, so no claim or note can be dropped',
      problems: last.problems,
    };
  }
  const plan = planDrops(lastGated.passage, lastGated.run.errors);
  if (!plan.ok) {
    return {
      ...base(),
      outcome: 'abandoned',
      reason: `${String(plan.unattributable.length)} failure(s) are not about a claim or a note, so dropping cannot fix them`,
      problems: lastGated.problems,
      report: lastGated.run.report,
    };
  }
  const { passage, dropped } = applyDrops(restamp(lastGated.passage, draft.meta.costUsd + repairCost()), plan.targets);
  const after = await gate(passage);
  if (after.stage !== 'passed') {
    return {
      ...base(),
      outcome: 'abandoned',
      reason: `dropping ${dropped.map((item) => `${item.kind} ${item.id}`).join(', ')} leaves a file that fails the gates`,
      problems: after.problems,
      report: after.run.report,
    };
  }
  return { ...base(), outcome: 'ready-with-drops', passage, text: after.text, path, report: after.run.report, dropped };
}

/** The passage with its provenance cost brought up to date. */
function restamp(passage: Passage, costUsd: number): Passage {
  return { ...passage, provenance: { ...passage.provenance, costUsd } };
}

/** The research output a written passage came from (identity fields, note ids, provenance and review removed). */
export function outputOfPassage(passage: Passage): ResearchOutput {
  return {
    summary: passage.summary,
    context: passage.context,
    translationNotes: passage.translationNotes.map(({ id: _id, ...note }) => note),
    claims: passage.claims,
    sources: passage.sources,
  };
}

/**
 * A draft from a research result: a written passage (its output and provenance), or a failed one that
 * kept the model output. `family` is the generator's family (a written passage only records the model);
 * a `fake` provenance stays fake. Returns `undefined` for a failure with nothing to repair.
 */
export function draftFromResult(
  result: WrittenResult | FailedResult,
  item: { readonly ref: string },
  meta: Omit<DraftMeta, 'costUsd'>,
): Draft | undefined {
  if (result.status === 'written') {
    const { provenance } = result.passage;
    return {
      key: result.key,
      ref: result.passage.ref,
      output: outputOfPassage(result.passage),
      meta: {
        ...meta,
        runId: provenance.runId,
        models: provenance.models,
        family: provenance.generator === 'fake' ? 'fake' : meta.family,
        promptVersion: provenance.promptVersion,
        createdAt: provenance.createdAt,
        costUsd: result.costUsd,
      },
    };
  }
  if (result.output === undefined) return undefined;
  return { key: result.key, ref: item.ref, output: result.output, meta: { ...meta, costUsd: result.costUsd } };
}

export interface ValidationRunReport {
  /** One result per draft, in order. */
  readonly results: readonly ValidationResult[];
  readonly ready: readonly string[];
  readonly readyWithDrops: readonly string[];
  readonly abandoned: readonly string[];
  /** Prompt version of the repair calls. */
  readonly repairPromptVersion: string;
}

export interface ValidateRunDeps extends Omit<ValidateDeps, 'llm' | 'meter'> {
  /** Builds the repair client for one draft; it must charge `meter`. */
  readonly llm: (meter: CostMeter) => LlmClient;
  /** The run's cost meter: each draft's repairs spend on a child capped at what is left of its passage budget. */
  readonly meter: CostMeter;
}

/** Pre-validates every draft of a run, in order, and collects the outcomes for the run report. */
export async function preValidateRun(drafts: readonly Draft[], deps: ValidateRunDeps): Promise<ValidationRunReport> {
  const results: ValidationResult[] = [];
  for (const draft of drafts) {
    const left = Math.max(0, deps.config.research.budget.perPassageUsd - draft.meta.costUsd);
    const meter = deps.meter.scope(`repair:${draft.key}`, left);
    results.push(await preValidate(draft, { ...deps, llm: deps.llm(meter), meter }));
  }
  const keys = (outcome: ValidationOutcome): string[] =>
    results.filter((result) => result.outcome === outcome).map((result) => result.key);
  return {
    results,
    ready: keys('ready'),
    readyWithDrops: keys('ready-with-drops'),
    abandoned: keys('abandoned'),
    repairPromptVersion: REPAIR_PROMPT_VERSION,
  };
}

const usd = (value: number): string => `$${value.toFixed(2)}`;

/** The pre-validation section of the run report, as plain text. */
export function formatValidationReport(report: ValidationRunReport): string {
  const lines = [
    `Pre-validation (gates 1–3, ${report.repairPromptVersion}): ${String(report.ready.length)} ready, ` +
      `${String(report.readyWithDrops.length)} ready with drops, ${String(report.abandoned.length)} abandoned`,
  ];
  for (const result of report.results) {
    const repairs = `${String(result.repairs)} repair${result.repairs === 1 ? '' : 's'}, ${usd(result.repairCostUsd)}`;
    lines.push(`- ${result.key}: ${result.outcome} (${repairs})`);
    if (result.repairStopped !== undefined) lines.push(`    repairs stopped: ${result.repairStopped}`);
    if (result.outcome === 'ready-with-drops') {
      for (const item of result.dropped) lines.push(`    dropped ${item.kind} ${item.id}: ${item.reason}`);
    }
    if (result.outcome === 'abandoned') {
      lines.push(`    ${result.reason}`);
      for (const problem of result.problems) lines.push(`    ${problem.replace(/\n/gu, '\n    ')}`);
    }
  }
  return lines.join('\n');
}
