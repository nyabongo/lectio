/**
 * Importer for the Open Scriptures Hebrew Bible (`openscriptures/morphhb`): the Westminster Leningrad Codex with
 * OSHB lemmas and morphology, as OSIS XML, one file per book under `wlc/`. It writes the 39 books of the Hebrew Old
 * Testament to `corpus/hbo-oshb/<BOOK>/<chapter>.json` in the original (Masoretic) versification.
 *
 * Tokens keep OSHB's data verbatim: the pointed surface with its `/` morpheme separators (`וְ/רָעָ֣ה`), the lemma
 * (`c/7489 a`) and the morphology code (`HC/Vqq3fs`). Corpus matching relies on the separators (see tokenForms).
 * Each `<w>` of a verse becomes one token, in document order. A ketiv (`<w type="x-ketiv">`) is followed by its qere
 * (`<note type="variant"><rdg type="x-qere"><w>`), so both readings can be found. Punctuation segments outside words
 * (maqaf, sof pasuq, paseq, pe/samekh), textual notes and alternative accentuations are dropped; letter segments
 * inside a word (large, small, suspended letters) stay part of it.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { findBook } from '@lectio/refs';
import { XMLParser } from 'fast-xml-parser';

import { resolveCorpusRoot } from '../cli/run.ts';
import type { CliIo } from '../cli/run.ts';
import { CorpusError } from '../format.ts';
import type { ChapterVerses, SourceInfo, Token } from '../format.ts';
import { downloadPinned } from '../import/download.ts';
import type { Downloader, PinnedArchive } from '../import/download.ts';
import { unpackTarball, writeChapter, writeEditionMetadata } from '../import/unpack.ts';

export const OSHB_EDITION = 'hbo-oshb';

/** The pinned upstream commit of openscriptures/morphhb (master, 2024-08-27). */
export const OSHB_COMMIT = '3d15126fb1ef74867fc1434be1942e837932691f';

/** GitHub's archive of the pinned commit and its sha256 (the archive is byte-stable; verified on download). */
export const OSHB_ARCHIVE: PinnedArchive = {
  url: `https://github.com/openscriptures/morphhb/archive/${OSHB_COMMIT}.tar.gz`,
  sha256: 'f979b5357fb18391928cd42ee1b95594db6e4f71d8da4e893c6c18f2688093a6',
};

/** The OSIS ids of the 39 books in `wlc/`, in Hebrew Bible file order of the NABRE canon. */
export const OSHB_BOOK_IDS = [
  'Gen',
  'Exod',
  'Lev',
  'Num',
  'Deut',
  'Josh',
  'Judg',
  'Ruth',
  '1Sam',
  '2Sam',
  '1Kgs',
  '2Kgs',
  '1Chr',
  '2Chr',
  'Ezra',
  'Neh',
  'Esth',
  'Job',
  'Ps',
  'Prov',
  'Eccl',
  'Song',
  'Isa',
  'Jer',
  'Lam',
  'Ezek',
  'Dan',
  'Hos',
  'Joel',
  'Amos',
  'Obad',
  'Jonah',
  'Mic',
  'Nah',
  'Hab',
  'Zeph',
  'Hag',
  'Zech',
  'Mal',
] as const;

/** The L-005 book code for an OSIS book id; throws a CorpusError for an id the book table does not know. */
export function bookCodeForOsis(osis: string): string {
  const book = findBook(osis);
  if (book === undefined || book.osis !== osis) throw new CorpusError(`unknown OSIS book id: ${JSON.stringify(osis)}`);
  return book.code;
}

/** SOURCE.json for the pinned archive. */
export function oshbSource(archive: PinnedArchive, version: string): SourceInfo {
  return {
    name: 'Open Scriptures Hebrew Bible (Westminster Leningrad Codex with lemmas and morphology)',
    language: 'hbo',
    upstreamUrl: archive.url,
    version,
    sha256: archive.sha256,
    licence: 'CC-BY-4.0 AND LicenseRef-PublicDomain',
    attribution:
      'Original work of the Open Scriptures Hebrew Bible available at https://github.com/openscriptures/morphhb. ' +
      'Hebrew text: The Westminster Leningrad Codex (public domain). ' +
      'Lemmas and morphology: Open Scriptures Hebrew Bible, licensed under CC BY 4.0 ' +
      '(https://creativecommons.org/licenses/by/4.0/).',
    versification: 'original',
  };
}

/** A node of fast-xml-parser's `preserveOrder` output: `{ tag: children, ':@': attributes }` or `{ '#text': … }`. */
type XmlNode = Record<string, unknown>;

const ATTRIBUTES = ':@';
const TEXT = '#text';

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: '',
  trimValues: false,
  parseTagValue: false,
  parseAttributeValue: false,
});

function tagOf(node: XmlNode): string {
  return Object.keys(node).find((key) => key !== ATTRIBUTES) as string;
}

function childrenOf(node: XmlNode): XmlNode[] {
  const children = node[tagOf(node)];
  return Array.isArray(children) ? (children as XmlNode[]) : [];
}

function attribute(node: XmlNode, name: string): string | undefined {
  const attributes = node[ATTRIBUTES] as Record<string, string> | undefined;
  return attributes?.[name];
}

function textOf(node: XmlNode): string {
  if (tagOf(node) === TEXT) return String(node[TEXT]);
  return childrenOf(node).map(textOf).join('');
}

/** One parsed book: its L-005 code and its chapters (chapter number to verses). */
export interface OsisBook {
  readonly book: string;
  readonly chapters: ReadonlyMap<number, ChapterVerses>;
}

const VERSE_ID = /^([1-3]?[A-Za-z]+)\.([1-9][0-9]*)\.([1-9][0-9]*)$/;

function wordToken(node: XmlNode, where: string): Token {
  const surface = textOf(node).trim();
  if (surface === '') throw new CorpusError(`${where}: empty <w>`);
  const lemma = attribute(node, 'lemma') ?? '';
  const morph = attribute(node, 'morph');
  return morph === undefined ? [surface, lemma] : [surface, lemma, morph];
}

/** The tokens of a verse's children: words, and the qere words inside variant notes. */
function verseTokens(nodes: readonly XmlNode[], where: string): Token[] {
  const tokens: Token[] = [];
  for (const node of nodes) {
    const tag = tagOf(node);
    if (tag === 'w') {
      tokens.push(wordToken(node, where));
    } else if (tag === 'note' && attribute(node, 'type') === 'variant') {
      for (const reading of childrenOf(node)) {
        if (tagOf(reading) === 'rdg' && attribute(reading, 'type') === 'x-qere') {
          tokens.push(...verseTokens(childrenOf(reading), where));
        }
      }
    }
  }
  return tokens;
}

/**
 * Parses one OSHB OSIS book file. Every `<verse osisID="Book.C.V">` anywhere in the document is read; all must name
 * `osis`, and no verse may appear twice.
 */
export function parseOsisBook(xml: string, osis: string): OsisBook {
  const book = bookCodeForOsis(osis);
  const chapters = new Map<number, Record<string, Token[]>>();
  const visit = (nodes: readonly XmlNode[]): void => {
    for (const node of nodes) {
      if (tagOf(node) !== 'verse') {
        visit(childrenOf(node));
        continue;
      }
      const id = attribute(node, 'osisID') ?? '';
      const match = VERSE_ID.exec(id);
      if (match === null || match[1] !== osis) throw new CorpusError(`${osis}: unexpected verse id ${JSON.stringify(id)}`);
      const chapter = Number(match[2]);
      const verse = match[3] as string;
      const verses = chapters.get(chapter) ?? {};
      if (Object.hasOwn(verses, verse)) throw new CorpusError(`${osis}: duplicate verse ${id}`);
      verses[verse] = verseTokens(childrenOf(node), id);
      chapters.set(chapter, verses);
    }
  };
  visit(parser.parse(xml) as XmlNode[]);
  if (chapters.size === 0) throw new CorpusError(`${osis}: no verses found`);
  return { book, chapters };
}

/** A Downloader over the WHATWG fetch API (Node's global fetch by default); non-2xx responses throw. */
export function fetchDownloader(fetchImpl: typeof fetch = fetch): Downloader {
  return {
    async fetchBytes(url) {
      const response = await fetchImpl(url);
      if (!response.ok) throw new Error(`GET ${url} failed: HTTP ${response.status}`);
      return new Uint8Array(await response.arrayBuffer());
    },
  };
}

export interface ImportOshbOptions {
  /** The corpus root (normally `<repo>/corpus`). */
  readonly root: string;
  /** Where the downloaded archive is cached (normally `<repo>/.cache/corpus`). */
  readonly cacheDir: string;
  readonly downloader: Downloader;
  /** Defaults to the pinned OSHB_ARCHIVE; tests pass a fixture archive. */
  readonly archive?: PinnedArchive;
  /** Recorded as SOURCE.json "version"; defaults to OSHB_COMMIT. */
  readonly version?: string;
  readonly log?: (line: string) => void;
}

export interface ImportSummary {
  readonly edition: string;
  readonly books: number;
  readonly chapters: number;
  readonly verses: number;
  readonly tokens: number;
}

/**
 * Downloads (or reuses the cached copy of) the pinned archive, verifies its sha256, and rewrites
 * `corpus/hbo-oshb/` from scratch, so a re-run gives byte-identical files and no stale chapter survives.
 */
export async function importOshb(options: ImportOshbOptions): Promise<ImportSummary> {
  const archive = options.archive ?? OSHB_ARCHIVE;
  const version = options.version ?? OSHB_COMMIT;
  const log = options.log ?? (() => undefined);
  const cached = join(options.cacheDir, `morphhb-${archive.sha256}.tar.gz`);
  log(`archive: ${archive.url}`);
  await downloadPinned(options.downloader, archive, cached);
  const unpacked = await mkdtemp(join(tmpdir(), 'lectio-oshb-'));
  try {
    await unpackTarball(cached, unpacked, { strip: 1 });
    const books: OsisBook[] = [];
    for (const osis of OSHB_BOOK_IDS) {
      const path = join(unpacked, 'wlc', `${osis}.xml`);
      const xml = await readFile(path, 'utf8').catch(() => {
        throw new CorpusError(`archive has no wlc/${osis}.xml`);
      });
      books.push(parseOsisBook(xml, osis));
    }
    const licence = await readFile(join(unpacked, 'LICENSE.md'), 'utf8').catch(() => {
      throw new CorpusError('archive has no LICENSE.md');
    });

    await rm(join(options.root, OSHB_EDITION), { recursive: true, force: true });
    await writeEditionMetadata(options.root, OSHB_EDITION, oshbSource(archive, version), licence);
    let chapters = 0;
    let verses = 0;
    let tokens = 0;
    for (const { book, chapters: bookChapters } of books) {
      for (const [chapter, chapterVerses] of bookChapters) {
        await writeChapter(options.root, OSHB_EDITION, book, chapter, chapterVerses);
        chapters += 1;
        for (const verseTokens of Object.values(chapterVerses)) {
          verses += 1;
          tokens += verseTokens.length;
        }
      }
      log(`${book}: ${bookChapters.size} chapters`);
    }
    return { edition: OSHB_EDITION, books: books.length, chapters, verses, tokens };
  } finally {
    await rm(unpacked, { recursive: true, force: true });
  }
}

/**
 * `npm run corpus:import:hebrew` (scripts/corpus/import-hebrew.mjs): imports into the corpus root that the other
 * corpus CLIs use, caching the archive in `<corpus root>/../.cache/corpus`. Exit code 0 on success, 1 on failure.
 */
export async function runImportHebrew(
  env: NodeJS.ProcessEnv,
  cwd: string,
  io: CliIo,
  overrides: Partial<Pick<ImportOshbOptions, 'downloader' | 'archive' | 'version'>> = {},
): Promise<number> {
  try {
    const root = resolveCorpusRoot(env, cwd);
    const summary = await importOshb({
      downloader: fetchDownloader(),
      ...overrides,
      root,
      cacheDir: join(dirname(root), '.cache', 'corpus'),
      log: io.out,
    });
    io.out(
      `${summary.edition}: ${summary.books} books, ${summary.chapters} chapters, ${summary.verses} verses, ` +
        `${summary.tokens} tokens written to ${join(root, summary.edition)}`,
    );
    return 0;
  } catch (error) {
    io.err(`corpus:import:hebrew failed: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}
