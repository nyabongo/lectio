/**
 * The on-disk corpus format.
 *
 * ```
 * corpus/<edition>/SOURCE.json          edition metadata (see SourceInfo)
 * corpus/<edition>/LICENSE.md           the upstream licence text
 * corpus/<edition>/<BOOK>/<chapter>.json  { "<verse>": [[surface, lemma, morph?], …] }
 * ```
 *
 * Book codes are plain strings (by convention the upper-cased NABRE codes of ADR 0004, such as `MT` or `GN`);
 * this package does not depend on `@lectio/refs`.
 */

/** Languages a corpus edition may declare (ISO 639-3). Aramaic uses the Hebrew normaliser. */
export const LANGUAGES = ['grc', 'hbo', 'arc', 'lat'] as const;
export type Language = (typeof LANGUAGES)[number];

/** The contents of `corpus/<edition>/SOURCE.json`. */
export interface SourceInfo {
  /** Human-readable edition name, e.g. "SBL Greek New Testament". */
  readonly name: string;
  readonly language: Language;
  /** Where the upstream archive was downloaded from. */
  readonly upstreamUrl: string;
  /** Upstream version tag or commit. */
  readonly version: string;
  /** Lower-case hex sha256 of the upstream archive. */
  readonly sha256: string;
  /** SPDX licence identifier, e.g. "CC-BY-4.0". */
  readonly licence: string;
  /** Attribution text required by the licence. */
  readonly attribution: string;
  /** Versification scheme of the verse files, e.g. "NABRE", "LXX", "Vulgate". */
  readonly versification: string;
}

/** One word: `[surface, lemma]` or `[surface, lemma, morph]`. */
export type Token = readonly [surface: string, lemma: string, morph?: string];

/** The contents of one chapter file: verse number (as a string) to tokens. */
export type ChapterVerses = Readonly<Record<string, readonly Token[]>>;

/** Thrown for malformed corpus files, unknown editions and invalid arguments. */
export class CorpusError extends Error {
  override readonly name = 'CorpusError';
}

export const SOURCE_FILE = 'SOURCE.json';
export const LICENSE_FILE = 'LICENSE.md';

const EDITION_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const BOOK_CODE = /^[A-Z0-9]+$/;
const SEGMENT = /^[A-Za-z0-9]+$/;
const SHA256 = /^[0-9a-f]{64}$/;

export function assertEditionId(edition: string): void {
  if (!EDITION_ID.test(edition)) throw new CorpusError(`invalid edition id: ${JSON.stringify(edition)}`);
}

export function assertBookCode(book: string): void {
  if (!BOOK_CODE.test(book)) throw new CorpusError(`invalid book code: ${JSON.stringify(book)}`);
}

/** Chapter and verse numbers may be numbers or strings of letters and digits (e.g. Greek Esther "A"). */
export function segment(kind: 'chapter' | 'verse', value: number | string): string {
  const text = String(value);
  if (!SEGMENT.test(text)) throw new CorpusError(`invalid ${kind}: ${JSON.stringify(value)}`);
  return text;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const SOURCE_KEYS = [
  'name',
  'language',
  'upstreamUrl',
  'version',
  'sha256',
  'licence',
  'attribution',
  'versification',
] as const;

/** Validates parsed `SOURCE.json` contents. `where` names the file in error messages. */
export function parseSource(value: unknown, where: string): SourceInfo {
  if (!isRecord(value)) throw new CorpusError(`${where}: expected an object`);
  for (const key of SOURCE_KEYS) {
    const field = value[key];
    if (typeof field !== 'string' || field.trim() === '') {
      throw new CorpusError(`${where}: "${key}" must be a non-empty string`);
    }
  }
  const unknownKeys = Object.keys(value).filter((key) => !(SOURCE_KEYS as readonly string[]).includes(key));
  if (unknownKeys.length > 0) throw new CorpusError(`${where}: unknown field(s) ${unknownKeys.join(', ')}`);
  const source = value as unknown as SourceInfo;
  if (!(LANGUAGES as readonly string[]).includes(source.language)) {
    throw new CorpusError(`${where}: "language" must be one of ${LANGUAGES.join(', ')}`);
  }
  if (!SHA256.test(source.sha256)) throw new CorpusError(`${where}: "sha256" must be 64 lower-case hex digits`);
  return {
    name: source.name,
    language: source.language,
    upstreamUrl: source.upstreamUrl,
    version: source.version,
    sha256: source.sha256,
    licence: source.licence,
    attribution: source.attribution,
    versification: source.versification,
  };
}

function isToken(value: unknown): value is Token {
  return (
    Array.isArray(value) &&
    (value.length === 2 || value.length === 3) &&
    value.every((part) => typeof part === 'string') &&
    value[0] !== ''
  );
}

/** Validates parsed chapter-file contents. `where` names the file in error messages. */
export function parseChapter(value: unknown, where: string): ChapterVerses {
  if (!isRecord(value)) throw new CorpusError(`${where}: expected an object of verses`);
  for (const [verse, tokens] of Object.entries(value)) {
    if (!SEGMENT.test(verse)) throw new CorpusError(`${where}: invalid verse key ${JSON.stringify(verse)}`);
    if (!Array.isArray(tokens)) throw new CorpusError(`${where}: verse ${verse} must be an array of tokens`);
    tokens.forEach((token: unknown, index) => {
      if (!isToken(token)) {
        throw new CorpusError(`${where}: verse ${verse} token ${index} must be [surface, lemma, morph?]`);
      }
    });
  }
  return value as ChapterVerses;
}

/** Orders verse keys numerically, then by any letter suffix ("1" < "2" < "10" < "10a" < "A"). */
export function compareVerseKeys(a: string, b: string): number {
  const na = Number.parseInt(a, 10);
  const nb = Number.parseInt(b, 10);
  const aNum = !Number.isNaN(na);
  const bNum = !Number.isNaN(nb);
  if (aNum && bNum && na !== nb) return na - nb;
  if (aNum !== bNum) return aNum ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Serialises a chapter deterministically: verses in order, one verse per line, trailing newline. */
export function serialiseChapter(verses: ChapterVerses): string {
  const keys = Object.keys(verses).sort(compareVerseKeys);
  if (keys.length === 0) return '{}\n';
  const lines = keys.map((key) => `  ${JSON.stringify(key)}: ${JSON.stringify(verses[key])}`);
  return `{\n${lines.join(',\n')}\n}\n`;
}

/** Serialises SOURCE.json deterministically, fields in their documented order. */
export function serialiseSource(source: SourceInfo): string {
  const ordered = Object.fromEntries(SOURCE_KEYS.map((key) => [key, source[key]]));
  return `${JSON.stringify(ordered, null, 2)}\n`;
}
