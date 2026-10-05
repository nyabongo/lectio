/** Narration in other languages (L-115): Kiswahili segments from approved, fresh translations, and the manifest by locale. */
export { SWAHILI_BOOKS, findSwahiliBook, swahiliBookEntries, swahiliBookNames } from './books.ts';
export type { SwahiliBook } from './books.ts';
export { localeManifest, localeOfKey, manifestByLocale, manifestLocales } from './manifest.ts';
export { loadTranslations, localeSegments } from './repo.ts';
export type { LocaleSegmentsOptions, LocaleSegmentsResult, SkippedTranslation } from './repo.ts';
export {
  LOCALE_NARRATION,
  SKIP_REASONS,
  buildLocaleSegments,
  localeNarration,
  skipReason,
  translationSegments,
} from './segments.ts';
export type {
  BuildLocaleSegmentsOptions,
  LocaleNarration,
  NarratableOptions,
  SkipReason,
  TranslationLookup,
} from './segments.ts';
export { SWAHILI_STRINGS, speakSwahiliReferences, swahiliSpokenRef } from './swahili.ts';
