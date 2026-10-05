/**
 * @lectio/research: the local research CLI (L-201: research runs on the owner's machine).
 *
 * The planner (`plan`, L-034) turns a calendar window into the passages still to research.
 * Agent orchestration (L-035), pre-validation (L-036), publishing (L-037), translation (L-112)
 * and the CLI entry point (L-038, `npm run research`) build on it.
 */
export const packageName = '@lectio/research';

export { PLAN_USAGE, UsageError, parsePlanArgs } from './plan/args.ts';
export type { ParsePlanArgsOptions, PlanArgs } from './plan/args.ts';
export { formatPlan } from './plan/format.ts';
export { NEEDS_REVIEW_LABEL, RESEARCH_BRANCH_PREFIX, WEEK_MS, plan, researchBranch } from './plan/plan.ts';
export type {
  LimitReason,
  Plan,
  PlanBudget,
  PlanCapacity,
  PlanInput,
  PlanWeekly,
  SkipReason,
  SkippedItem,
  WorkItem,
} from './plan/plan.ts';

// Agent orchestration (L-035).
export {
  DEFAULT_RESEARCH_MAX_TOKENS,
  DEFAULT_RESEARCH_TOOLS,
  buildResearchRequest,
  createRunId,
  prettierJson,
  researchPassage,
  researchRun,
} from './agent/research.ts';
export type {
  FailedResult,
  OverBudgetResult,
  PassageResult,
  ResearchDeps,
  ResearchRunResult,
  WrittenResult,
} from './agent/research.ts';
export { assemblePassage, slugify } from './agent/assemble.ts';
export type { AssembleMeta } from './agent/assemble.ts';
export { RESEARCH_PROMPT, loadPromptTemplate } from './agent/prompt.ts';
export type { PromptTemplate } from './agent/prompt.ts';
export { MAX_TRANSLATION_NOTES, RESEARCH_RESPONSE_SCHEMA } from './agent/schema.ts';
export type { ResearchOutput } from './agent/schema.ts';

// Pre-validation (L-036), publishing (L-037) and translation (L-112).
export * from './validate/index.ts';
export * from './publish/index.ts';
export * from './translate/index.ts';

// The CLI entry point (L-038).
export { COMMON_USAGE, FIXUP_USAGE, USAGE, parseCommand } from './cli/args.ts';
export type { Command, CommonArgs, ProviderMode } from './cli/args.ts';
export { BudgetRefusedError, planCeilingUsd, runCeilingUsd } from './cli/budget.ts';
export { FixupRefusedError, formatFixupReport, runFixup } from './cli/fixup.ts';
export type { FixupDeps, FixupInput, FixupReport, FixupStatus, PrFiles } from './cli/fixup.ts';
export {
  FIXUP_RULES,
  GATES_BOT,
  GateOutputError,
  fixupFindings,
  latestGatesComment,
  parseGatesComment,
  parseGatesReport,
} from './cli/gates-comment.ts';
export type { GateFindings } from './cli/gates-comment.ts';
export { gitPrFiles } from './cli/git.ts';
export { DryRunError, dryRunGitHub, main, processContext } from './cli/main.ts';
export type { CliContext, CliIo } from './cli/main.ts';
export { LIVE_FACTORIES, ProviderSetupError, RoleRoutedLlm, composeProviders } from './cli/providers.ts';
export type { ComposeOptions, LiveFactories, Toolkit } from './cli/providers.ts';
export { checkoutReader, closedKeys, planWindow, runResearch } from './cli/run.ts';
export type { ClosedSkip, RunDeps, RunReport, SummaryRow } from './cli/run.ts';
export { formatRunReport, formatSummary } from './cli/summary.ts';
