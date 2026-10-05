/**
 * @lectio/textguard: a hash-only shingle index of public-domain English Bibles
 * and the longest-verbatim-run check the licence guard (gate 3, L-026) uses.
 * No text is stored: only sorted 64-bit hashes of n-word shingles.
 */
export const packageName = '@lectio/textguard';

export { NORMALISER_VERSION, normaliseWord, tokenise } from './normalise.ts';
export type { Token } from './normalise.ts';
export { DEFAULT_SHINGLE_SIZE, KEY_BITS, mix64, shingleKeys, wordHash } from './hash.ts';
export {
  buildIndex,
  collectShingleKeys,
  encodeIndex,
  INDEX_FORMAT_VERSION,
  INDEX_HEADER_BYTES,
  INDEX_MAGIC,
  loadIndex,
  riceParameter,
} from './index-file.ts';
export type { BuildIndexOptions, ShingleIndex } from './index-file.ts';
export { longestRun, longestRunOfKeys, longestRunOfWordHashes } from './run.ts';
export type { Run, WordRun } from './run.ts';
export { readZip } from './zip.ts';
export type { ZipEntry } from './zip.ts';
export { createFakeDownloader, createFetchDownloader } from './download.ts';
export type { Downloader } from './download.ts';
export {
  DEFAULT_SAMPLES,
  LIMITATION,
  parseBuildArgs,
  PUBLIC_DOMAIN_SOURCES,
  readChapters,
  runGuardBuild,
  SAMPLE_WORDS,
  sampleShingleKeys,
} from './build.ts';
export type {
  GuardBuildArgs,
  GuardBuildOptions,
  GuardBuildResult,
  GuardManifest,
  GuardSource,
  SampleSelector,
  SelfCheckSample,
} from './build.ts';
