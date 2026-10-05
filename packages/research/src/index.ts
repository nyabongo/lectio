/**
 * @lectio/research: the local research CLI (L-201: research runs on the owner's machine).
 *
 * The planner (`plan`, L-034) turns a calendar window into the passages still to research.
 * Agent orchestration (L-035), pre-validation (L-036), publishing (L-037) and the CLI entry
 * point (L-038) build on it.
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
