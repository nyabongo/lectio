/**
 * Regional calendar overrides (L-015): the file format, the engine that applies it to
 * romcal's output, and the region's calendar. Kenya's data is `calendar/overrides/kenya.json`.
 */
export { PROPER_PRECEDENCE, addedCelebration, applyOverrides } from './apply.ts';
export type { ApplyResult, BaseDayLookup, OverrideEvent, OverrideOutcome } from './apply.ts';
export { baseDays, generateRegionalDays, loadOverrides, overridesPath, transferOptions } from './region.ts';
export {
  CONFIDENCE_LEVELS,
  OVERRIDE_ACTIONS,
  OVERRIDE_RANKS,
  OverridesError,
  TRANSFER_FLAGS,
  isMonthDay,
  parseOverrides,
  pendingSignOff,
  regionalOverridesSchema,
} from './schema.ts';
export type {
  AddEntry,
  Confidence,
  MoveEntry,
  OverrideAction,
  OverrideEntry,
  OverrideRank,
  OverrideSource,
  RankEntry,
  RegionalOverrides,
  RemoveEntry,
  TransferFlag,
  TransferSetting,
} from './schema.ts';
