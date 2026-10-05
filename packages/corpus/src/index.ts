/**
 * @lectio/corpus: the original-language corpus format, normalisers, query API and importer helpers.
 */
export {
  assertBookCode,
  assertEditionId,
  assertSha256,
  compareVerseKeys,
  CorpusError,
  LANGUAGES,
  LICENSE_FILE,
  parseChapter,
  parseSource,
  serialiseChapter,
  serialiseSource,
  SOURCE_FILE,
} from './format.ts';
export type { ChapterVerses, Language, SourceInfo, Token } from './format.ts';
export {
  lemmaKey,
  normaliseGreek,
  normaliseHebrew,
  normaliseLatin,
  normaliserFor,
  phraseWords,
  tokenForms,
} from './normalise.ts';
export type { TokenField, TokenFormsOptions } from './normalise.ts';
export { openCorpus } from './corpus.ts';
export type { Corpus, FindResult, MatchMode, MatchOptions, OpenCorpusOptions, WordMatch } from './corpus.ts';
export { formatLicences, listLicences } from './licences.ts';
export type { LicenceEntry } from './licences.ts';
export * from './import/index.ts';
