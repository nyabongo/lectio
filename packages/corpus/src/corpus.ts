/**
 * The query API: open a corpus directory and look up verses and words. Files are read lazily, on first use, and
 * cached for the lifetime of the Corpus object.
 */
import { readdir, readFile as fsReadFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  assertBookCode,
  assertEditionId,
  CorpusError,
  parseChapter,
  parseSource,
  segment,
  SOURCE_FILE,
} from './format.ts';
import type { ChapterVerses, SourceInfo, Token } from './format.ts';
import { normaliserFor, phraseWords, tokenForms } from './normalise.ts';

export type MatchMode = 'surface' | 'lemma' | 'either';

export interface MatchOptions {
  /** What a query word is compared against. Default `'either'`. */
  readonly match?: MatchMode;
}

/** A matching token and its 0-based position in the verse. */
export interface WordMatch {
  readonly index: number;
  readonly token: Token;
}

export interface FindResult {
  /** False when the verse is not in the edition (so "no match" means something only when this is true). */
  readonly verseFound: boolean;
  readonly matches: readonly WordMatch[];
}

export interface Corpus {
  readonly root: string;
  /** Edition ids (directories holding a SOURCE.json), sorted. */
  editions(): Promise<string[]>;
  /** The edition's SOURCE.json; throws a CorpusError for an unknown edition. */
  source(edition: string): Promise<SourceInfo>;
  /** The verse's tokens, or undefined when the chapter or verse is not in the edition. */
  getVerse(edition: string, book: string, chapter: number | string, verse: number | string): Promise<Token[] | undefined>;
  /** Tokens of the verse whose surface form and/or lemma equal `word` after normalisation. */
  findWord(
    edition: string,
    book: string,
    chapter: number | string,
    verse: number | string,
    word: string,
    options?: MatchOptions,
  ): Promise<FindResult>;
  /** Whether the words of `phrase` occur as consecutive tokens of the verse (after normalisation). */
  phraseOccurs(
    edition: string,
    book: string,
    chapter: number | string,
    verse: number | string,
    phrase: string,
    options?: MatchOptions,
  ): Promise<boolean>;
}

export interface OpenCorpusOptions {
  /** Reads a file as UTF-8 and returns undefined when it does not exist. Defaults to node:fs. Injectable for tests. */
  readonly readFile?: (path: string) => Promise<string | undefined>;
  /** Lists the sub-directories of a directory ([] when it does not exist). Defaults to node:fs. */
  readonly listDirectories?: (path: string) => Promise<string[]>;
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTDIR');
}

export async function readTextFile(path: string): Promise<string | undefined> {
  try {
    return await fsReadFile(path, 'utf8');
  } catch (error) {
    if (isNotFound(error)) return undefined;
    throw error;
  }
}

export async function listSubdirectories(path: string): Promise<string[]> {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch (error) {
    if (isNotFound(error)) return [];
    throw error;
  }
}

function parseJson(text: string, where: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new CorpusError(`${where}: invalid JSON (${(error as Error).message})`);
  }
}

/** Plain code-point order, independent of locale, so listings are deterministic everywhere. */
export function byCodePoint(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Opens the corpus rooted at `root` (normally `<repo>/corpus`). Nothing is read until a query needs it. */
export function openCorpus(root: string, options: OpenCorpusOptions = {}): Corpus {
  const readFile = options.readFile ?? readTextFile;
  const listDirectories = options.listDirectories ?? listSubdirectories;
  const sources = new Map<string, Promise<SourceInfo>>();
  const chapters = new Map<string, Promise<ChapterVerses | undefined>>();

  function source(edition: string): Promise<SourceInfo> {
    assertEditionId(edition);
    let cached = sources.get(edition);
    if (cached === undefined) {
      const path = join(root, edition, SOURCE_FILE);
      cached = readFile(path).then((text) => {
        if (text === undefined) throw new CorpusError(`unknown edition: ${edition} (no ${path})`);
        return parseSource(parseJson(text, path), path);
      });
      cached.catch(() => sources.delete(edition));
      sources.set(edition, cached);
    }
    return cached;
  }

  function chapterFile(edition: string, book: string, chapter: string): Promise<ChapterVerses | undefined> {
    const key = `${edition}/${book}/${chapter}`;
    let cached = chapters.get(key);
    if (cached === undefined) {
      const path = join(root, edition, book, `${chapter}.json`);
      cached = readFile(path).then((text) => (text === undefined ? undefined : parseChapter(parseJson(text, path), path)));
      cached.catch(() => chapters.delete(key));
      chapters.set(key, cached);
    }
    return cached;
  }

  async function getVerse(
    edition: string,
    book: string,
    chapter: number | string,
    verse: number | string,
  ): Promise<Token[] | undefined> {
    assertBookCode(book);
    const c = segment('chapter', chapter);
    const v = segment('verse', verse);
    await source(edition);
    const verses = await chapterFile(edition, book, c);
    if (verses === undefined || !Object.hasOwn(verses, v)) return undefined;
    return [...(verses[v] as readonly Token[])];
  }

  /** The forms each token matches (see tokenForms), plus a predicate for one query word against one token. */
  async function prepare(
    edition: string,
    book: string,
    chapter: number | string,
    verse: number | string,
    options: MatchOptions,
  ) {
    const tokens = await getVerse(edition, book, chapter, verse);
    const { language } = await source(edition);
    const normalise = normaliserFor(language);
    const mode = options.match ?? 'either';
    const forms = (tokens ?? []).map(
      ([surface, lemma]) => [new Set(tokenForms(language, surface)), new Set(tokenForms(language, lemma, 'lemma'))] as const,
    );
    const matches = (index: number, word: string): boolean => {
      const [surface, lemma] = forms[index] as readonly [Set<string>, Set<string>];
      return (mode !== 'lemma' && surface.has(word)) || (mode !== 'surface' && lemma.has(word));
    };
    return { tokens, language, normalise, matches };
  }

  return {
    root,

    async editions() {
      const directories = await listDirectories(root);
      const withSource = await Promise.all(
        directories.map(async (name) => ((await readFile(join(root, name, SOURCE_FILE))) === undefined ? [] : [name])),
      );
      return withSource.flat().sort(byCodePoint);
    },

    source,
    getVerse,

    async findWord(edition, book, chapter, verse, word, options = {}) {
      const { tokens, normalise, matches } = await prepare(edition, book, chapter, verse, options);
      if (tokens === undefined) return { verseFound: false, matches: [] };
      const query = normalise(word);
      if (query === '') return { verseFound: true, matches: [] };
      const found = tokens.flatMap((token, index) => (matches(index, query) ? [{ index, token }] : []));
      return { verseFound: true, matches: found };
    },

    async phraseOccurs(edition, book, chapter, verse, phrase, options = {}) {
      const { tokens, language, matches } = await prepare(edition, book, chapter, verse, options);
      const words = phraseWords(language, phrase);
      if (tokens === undefined || words.length === 0) return false;
      for (let start = 0; start + words.length <= tokens.length; start += 1) {
        if (words.every((word, offset) => matches(start + offset, word))) return true;
      }
      return false;
    },
  };
}
