/**
 * Pre-validation (step 4b of a research run, L-036): gates 1–3 in-process, the self-repair loop and
 * the drop-or-abandon fallback. The CLI entry point (L-038) runs it between research and publishing
 * and re-exports it from the package root.
 */
export { applyDrops, planDrops, stripClaims } from './drop.ts';
export type { DropKind, DropPlan, DropResult, DropTarget } from './drop.ts';
export { PRE_VALIDATION_GATE_IDS, contentPrefix, draftPath, preValidationGates, runDraftGates } from './gates.ts';
export type { DraftGateDeps, DraftGateRun } from './gates.ts';
export {
  DEFAULT_REPAIR_MAX_TOKENS,
  DEFAULT_REPAIR_TOOLS,
  REPAIR_PROMPT_VERSION,
  buildRepairRequest,
  fenceFor,
  repairSystemPrompt,
  repairUserMessage,
} from './prompt.ts';
export type { RepairInput, RepairOptions } from './prompt.ts';
export { draftFromResult, formatValidationReport, outputOfPassage, preValidate, preValidateRun } from './validate.ts';
export type {
  AbandonedValidation,
  Attempt,
  AttemptStage,
  Draft,
  DraftMeta,
  ReadyValidation,
  ReadyWithDropsValidation,
  ValidateDeps,
  ValidateRunDeps,
  ValidationOutcome,
  ValidationResult,
  ValidationRunReport,
} from './validate.ts';
