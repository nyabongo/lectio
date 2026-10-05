/**
 * Research agent orchestration (steps 3–4 of a run): for each planned passage, one
 * `LlmClient.generate` call with server-side web search and fetch and the research response
 * schema, then the assembler, then `passages/<key>.json`.
 *
 * Every passage spends on its own child of the run's cost meter, capped at
 * `research.budget.perPassageUsd`. A charge past that ceiling (or the run's) aborts the passage
 * cleanly: nothing is written and the run goes on with the next passage, or stops once the run
 * budget is gone. Self-repair (L-036) and pull requests (L-037) build on the results.
 */
import { mkdir, writeFile as fsWriteFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { LectioConfig } from '@lectio/config';
import { ContentError, formatIssue } from '@lectio/content';
import type { ContentRepo } from '@lectio/content';
import type { Corpus } from '@lectio/corpus';
import { BudgetExceededError, ProviderError, validateAgainstSchema } from '@lectio/providers';
import type { Clock, CostMeter, LlmClient, LlmRequest, LlmTool } from '@lectio/providers';
import type { Passage } from '@lectio/schema/passage';
import { format, resolveConfig } from 'prettier';

import type { WorkItem } from '../plan/plan.ts';
import { assemblePassage, passagePath } from './assemble.ts';
import { calendarContext, formatCalendarContext } from './calendar.ts';
import { formatOriginalText, loadOriginalText } from './original.ts';
import type { LoadOriginalOptions } from './original.ts';
import { loadPromptTemplate, renderTemplate } from './prompt.ts';
import type { PromptTemplate } from './prompt.ts';
import { MAX_EXCERPT_WORDS, RESEARCH_RESPONSE_SCHEMA } from './schema.ts';
import type { ResearchOutput } from './schema.ts';

/** Server-side tools the research call offers the model. */
export const DEFAULT_RESEARCH_TOOLS: readonly LlmTool[] = [
  { kind: 'web_search', maxUses: 12 },
  { kind: 'web_fetch', maxUses: 20 },
];

/** Output token cap of the research call. */
export const DEFAULT_RESEARCH_MAX_TOKENS = 16_000;

export interface ResearchDeps {
  /** Builds an LLM client that charges `meter` (called once per passage with that passage's meter). */
  readonly llm: (meter: CostMeter) => LlmClient;
  /** The run's cost meter; each passage spends on a child scoped to `research.budget.perPassageUsd`. */
  readonly meter: CostMeter;
  readonly corpus: Corpus;
  readonly repo: Pick<ContentRepo, 'calendarYear'>;
  readonly config: Pick<LectioConfig, 'research' | 'site'>;
  readonly clock: Clock;
  /** Content repository root: passage files are written to `<contentRoot>/passages/<key>.json`. */
  readonly contentRoot: string;
  readonly runId: string;
  /** The prompt template; default `prompts/research-v1.md`. */
  readonly prompt?: PromptTemplate;
  /** Commentary locale; default `site.defaultLocale`. */
  readonly locale?: string;
  readonly tools?: readonly LlmTool[];
  readonly maxTokens?: number;
  readonly editionsFor?: LoadOriginalOptions['editionsFor'];
  /** Writes a file (parent directories exist). Default node:fs. */
  readonly writeFile?: (path: string, text: string) => Promise<void>;
  /** Formats the passage JSON the way the repository's Prettier check expects. Default Prettier. */
  readonly format?: (json: string, path: string) => Promise<string>;
}

interface ResultBase {
  readonly key: string;
  /** What this passage spent, in USD. */
  readonly costUsd: number;
}

export interface WrittenResult extends ResultBase {
  readonly status: 'written';
  /** Repository-relative path, `passages/<key>.json`. */
  readonly path: string;
  readonly passage: Passage;
}

export interface OverBudgetResult extends ResultBase {
  readonly status: 'over-budget';
  /** Label of the meter whose ceiling was hit (`passage:<key>` or the run's). */
  readonly meter: string;
  /** True when the run budget is spent, so no further passage can start. */
  readonly runExhausted: boolean;
}

export interface FailedResult extends ResultBase {
  readonly status: 'failed';
  readonly error: string;
  /** Schema problems of the assembled passage or of the model output, one per line. */
  readonly issues: readonly string[];
  /** The model output, when there was one (for self-repair, L-036). */
  readonly output?: unknown;
}

export type PassageResult = WrittenResult | OverBudgetResult | FailedResult;

export interface ResearchRunResult {
  readonly results: readonly PassageResult[];
  /** Planned passages never started because the run budget ran out. */
  readonly notStarted: readonly string[];
  readonly spentUsd: number;
}

/** A run id from the run's start time, for example `research-20261005T075000Z`. */
export function createRunId(now: Date): string {
  return `research-${now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, 'Z')}`;
}

/** Formats JSON with the repository's Prettier settings for `path`. */
export async function prettierJson(json: string, path: string): Promise<string> {
  const options = await resolveConfig(path);
  return format(json, { ...options, parser: 'json', filepath: path });
}

async function defaultWriteFile(path: string, text: string): Promise<void> {
  await fsWriteFile(path, text, 'utf8');
}

/** Builds the research request for one passage. */
export async function buildResearchRequest(
  item: WorkItem,
  deps: ResearchDeps,
  prompt: PromptTemplate,
): Promise<LlmRequest> {
  const context = calendarContext(deps.repo, item);
  const original = await loadOriginalText(
    deps.corpus,
    item.key,
    deps.editionsFor === undefined ? {} : { editionsFor: deps.editionsFor },
  );
  const values = {
    key: item.key,
    ref: item.ref,
    slot: context?.slot ?? 'unknown',
    locale: deps.locale ?? deps.config.site.defaultLocale,
    calendar: formatCalendarContext(context),
    originalText: formatOriginalText(original),
    maxExcerptWords: MAX_EXCERPT_WORDS,
  };
  return {
    role: 'generator',
    system: renderTemplate(prompt.system, values),
    messages: [{ role: 'user', content: renderTemplate(prompt.user, values) }],
    tools: deps.tools ?? DEFAULT_RESEARCH_TOOLS,
    responseSchema: RESEARCH_RESPONSE_SCHEMA,
    model: deps.config.research.models.generator.model,
    maxTokens: deps.maxTokens ?? DEFAULT_RESEARCH_MAX_TOKENS,
  };
}

/** Researches one passage and writes its file. Unexpected (programming) errors are rethrown. */
export async function researchPassage(item: WorkItem, deps: ResearchDeps): Promise<PassageResult> {
  const meter = deps.meter.scope(`passage:${item.key}`, deps.config.research.budget.perPassageUsd);
  const spent = (): number => meter.spentUsd();
  let output: unknown;
  try {
    meter.assertWithinBudget();
    const prompt = deps.prompt ?? (await loadPromptTemplate());
    const request = await buildResearchRequest(item, deps, prompt);
    const response = await deps.llm(meter).generate(request);
    output = response.output;
    const problems = validateAgainstSchema(RESEARCH_RESPONSE_SCHEMA, output);
    if (problems.length > 0) {
      return {
        status: 'failed',
        key: item.key,
        costUsd: spent(),
        error: 'the model output does not match the research schema',
        issues: problems,
        output,
      };
    }
    const passage = assemblePassage(output as ResearchOutput, {
      key: item.key,
      ref: item.ref,
      locale: deps.locale ?? deps.config.site.defaultLocale,
      runId: deps.runId,
      models: [response.model],
      family: response.family,
      promptVersion: prompt.version,
      createdAt: deps.clock.now().toISOString(),
      costUsd: spent(),
    });
    const path = passagePath(item.key);
    const absolute = join(deps.contentRoot, path);
    const text = await (deps.format ?? prettierJson)(`${JSON.stringify(passage, null, 2)}\n`, absolute);
    await mkdir(dirname(absolute), { recursive: true });
    await (deps.writeFile ?? defaultWriteFile)(absolute, text);
    return { status: 'written', key: item.key, costUsd: spent(), path, passage };
  } catch (error) {
    if (error instanceof BudgetExceededError) {
      return {
        status: 'over-budget',
        key: item.key,
        costUsd: spent(),
        meter: error.meter,
        runExhausted: deps.meter.remainingUsd() <= 0,
      };
    }
    if (error instanceof ContentError) {
      const issues = error.issues.map((issue) => formatIssue(error.file, issue));
      return {
        status: 'failed',
        key: item.key,
        costUsd: spent(),
        error: 'the assembled passage is invalid',
        issues,
        output,
      };
    }
    // A provider failure (malformed output after the client's retries, an outage) ends this passage only.
    if (error instanceof ProviderError) {
      return { status: 'failed', key: item.key, costUsd: spent(), error: error.message, issues: [] };
    }
    throw error;
  }
}

/** Researches the planned passages in order, stopping once the run budget is spent. */
export async function researchRun(items: readonly WorkItem[], deps: ResearchDeps): Promise<ResearchRunResult> {
  const prompt = deps.prompt ?? (await loadPromptTemplate());
  const results: PassageResult[] = [];
  const notStarted: string[] = [];
  for (const item of items) {
    if (deps.meter.remainingUsd() <= 0) {
      notStarted.push(item.key);
      continue;
    }
    results.push(await researchPassage(item, { ...deps, prompt }));
  }
  return { results, notStarted, spentUsd: deps.meter.spentUsd() };
}
