/**
 * @lectio/lectionary: the lectionary reference-data format (citations only, never text), the resolver
 * from a calendar day to its Masses and readings, and the check, cross-check and LitCal import tools.
 * See docs/decisions/011-lectionary-source.md.
 */
export const packageName = '@lectio/lectionary';

export {
  canonicalRef,
  formatCanonical,
  hasLetters,
  parsePrinted,
  refKey,
  singlePsalmNumber,
  stripLetters,
  verseSet,
} from './canonical.ts';
export { checkLectionary, checkRefString, checkSundaySecondReadings } from './check.ts';
export type { CheckOptions, CheckResult, CheckStats } from './check.ts';
export { ConversionError, toCanonical } from './convert.ts';
export { blockRows, crosscheckBlock, parseCrosscheckFile, renderDisputes } from './crosscheck.ts';
export type {
  ConsultedEntry,
  CrosscheckEntry,
  CrosscheckFile,
  CrosscheckResult,
  Disagreement,
  SingleSource,
} from './crosscheck.ts';
export { importLitcal, mergeImported, parseManifest, serialiseBlockFile } from './import/litcal.ts';
export type {
  ImportedReading,
  LitcalImport,
  LitcalImportResult,
  LitcalManifest,
  MergeResult,
  RemovedMass,
  TextFetcher,
} from './import/litcal.ts';
export {
  PROPER_OF_TIME_KEY,
  SEASON_PREFIX,
  SLUG,
  WEEKDAYS,
  compareKeys,
  isSundayKey,
  properOfTimeKey,
  weekdayOf,
} from './keys.ts';
export type { Season, Weekday } from './keys.ts';
export { RESERVED_DIRS, listBlocks, loadBlock, loadLectionary, loadRegistry } from './load.ts';
export type { LoadResult } from './load.ts';
export { Lectionary, epiphanyOf, resolveDay } from './resolve.ts';
export type {
  CelebrationRank,
  LectionaryCelebration,
  LectionaryDay,
  ResolveOptions,
  Resolution,
  ResolvedAlternative,
  ResolvedMass,
  ResolvedReading,
} from './resolve.ts';
export { slotRanker, sortBySlot } from './slots.ts';
export { SOURCE_LINE, checkSource, locatorRegExp, parseRegistry, splitSource } from './sources.ts';
export type { ParsedSource } from './sources.ts';
export * from './types.ts';
export { validateBlockFile } from './validate.ts';
