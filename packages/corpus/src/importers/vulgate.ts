/**
 * Importer for the Clementine Vulgate Project's raw text files (public domain), pinned to one commit of
 * https://bitbucket.org/clementinetextproject/text and its archive's sha256.
 *
 * The upstream format (described in the project's vulsearch4 README): one `.lat` file per book, codepage 1252, DOS
 * line endings, one verse per line as `<chapter>:<verse> <text>`. Inside the text, `\` marks a paragraph, `[` and `]`
 * open and close poetry, `/` breaks a poetry line and `<…>` holds a speaker label or heading (`<Sponsa>`, `<Aleph>`);
 * the prologues of Lamentations and Sirach sit at the start of 1:1 after `<Prologus>`, up to the first `[`.
 *
 * Output: `corpus/lat-vulgate-clementine/<BOOK>/<chapter>.json` with Vulgate chapter and verse numbers (Ps 144 is
 * Hebrew Ps 145; lookups from canonical references go through the L-006 mapping) under the NABRE book codes of
 * ADR 0004. Markup and speaker labels are dropped; each word keeps its attached punctuation as its surface form and
 * has an empty lemma (the source is not lemmatised). A prologue is stored as verse `prologue` of chapter 1.
 */
import { mkdir, mkdtemp, readdir, readFile, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { CorpusError } from '../format.ts';
import type { ChapterVerses, SourceInfo, Token } from '../format.ts';
import { downloadPinned } from '../import/download.ts';
import type { Downloader, PinnedArchive } from '../import/download.ts';
import { unpackTarball, writeChapter, writeEditionMetadata } from '../import/unpack.ts';

export const VULGATE_EDITION = 'lat-vulgate-clementine';

const COMMIT = 'edc85da058be630183d26e4deb6714ade80e600c';
const WEBSITE_COMMIT = '48da7dbf64990b44afb7fb809dc7e28bc119817f';

/** The pinned upstream: the text repository's archive at commit edc85da (2022-10-22, the latest correction). */
export const CLEMENTINE_VULGATE: PinnedArchive & { readonly version: string } = {
  url: `https://bitbucket.org/clementinetextproject/text/get/${COMMIT}.tar.gz`,
  sha256: 'bd7c226655a51424fdb195f38000e7a215d48ec8c88391227c85418b7e7db0c7',
  version: COMMIT,
};

/** Upstream file name (without `.lat`) to NABRE book code (ADR 0004): the 73 books of the Catholic canon. */
export const VULGATE_BOOKS: Readonly<Record<string, string>> = {
  Gn: 'GN',
  Ex: 'EX',
  Lv: 'LV',
  Nm: 'NM',
  Dt: 'DT',
  Jos: 'JOS',
  Jdc: 'JGS',
  Rt: 'RU',
  '1Rg': '1SM',
  '2Rg': '2SM',
  '3Rg': '1KGS',
  '4Rg': '2KGS',
  '1Par': '1CHR',
  '2Par': '2CHR',
  Esr: 'EZR',
  Neh: 'NEH',
  Tob: 'TB',
  Jdt: 'JDT',
  Est: 'EST',
  '1Mcc': '1MC',
  '2Mcc': '2MC',
  Job: 'JB',
  Ps: 'PS',
  Pr: 'PRV',
  Ecl: 'ECCL',
  Ct: 'SG',
  Sap: 'WIS',
  Sir: 'SIR',
  Is: 'IS',
  Jr: 'JER',
  Lam: 'LAM',
  Bar: 'BAR',
  Ez: 'EZ',
  Dn: 'DN',
  Os: 'HOS',
  Joel: 'JL',
  Am: 'AM',
  Abd: 'OB',
  Jon: 'JON',
  Mch: 'MI',
  Nah: 'NA',
  Hab: 'HB',
  Soph: 'ZEP',
  Agg: 'HG',
  Zach: 'ZEC',
  Mal: 'MAL',
  Mt: 'MT',
  Mc: 'MK',
  Lc: 'LK',
  Jo: 'JN',
  Act: 'ACTS',
  Rom: 'ROM',
  '1Cor': '1COR',
  '2Cor': '2COR',
  Gal: 'GAL',
  Eph: 'EPH',
  Phlp: 'PHIL',
  Col: 'COL',
  '1Thes': '1THES',
  '2Thes': '2THES',
  '1Tim': '1TM',
  '2Tim': '2TM',
  Tit: 'TI',
  Phlm: 'PHLM',
  Hbr: 'HEB',
  Jac: 'JAS',
  '1Ptr': '1PT',
  '2Ptr': '2PT',
  '1Jo': '1JN',
  '2Jo': '2JN',
  '3Jo': '3JN',
  Jud: 'JUDE',
  Apc: 'RV',
};

/** The verse key a book's prologue (Lamentations, Sirach) is stored under, in chapter 1. */
export const PROLOGUE_VERSE = 'prologue';

const LINE = /^([1-9][0-9]*):([1-9][0-9]*) (.+)$/u;
const PROLOGUE = '<Prologus>';
const LABEL = /<[^>]*>/gu;
const MARKUP = /[[\]/\\]/gu;
const LETTER = /\p{L}/u;

/** Decodes an upstream file (codepage 1252: `æ` is 0xE6, `œ` is 0x9C). */
export function decodeCp1252(bytes: Uint8Array): string {
  return new TextDecoder('windows-1252').decode(bytes);
}

/**
 * Splits one verse's text into tokens: speaker labels and markup are removed, the rest is split at whitespace, and
 * pieces without a letter (the free-standing `: ; ? !` of the upstream punctuation) are dropped.
 */
export function tokeniseVerse(text: string): Token[] {
  return text
    .replace(LABEL, ' ')
    .replace(MARKUP, ' ')
    .split(/\s+/u)
    .filter((word) => LETTER.test(word))
    .map((word): Token => [word, '']);
}

/** One book: chapter number (as a string) to its verses. */
export type VulgateBook = ReadonlyMap<string, ChapterVerses>;

/** Parses one decoded `.lat` file. `where` names the file in error messages. */
export function parseVulgateBook(text: string, where: string): VulgateBook {
  const chapters = new Map<string, Record<string, Token[]>>();
  const lines = text.split(/\r?\n/u);
  lines.forEach((line, index) => {
    if (line === '' && index === lines.length - 1) return;
    const match = LINE.exec(line);
    if (match === null) throw new CorpusError(`${where}:${index + 1}: expected "<chapter>:<verse> <text>"`);
    const [, chapter, verse, body] = match as unknown as [string, string, string, string];
    const verses = chapters.get(chapter) ?? {};
    chapters.set(chapter, verses);
    if (verse in verses) throw new CorpusError(`${where}:${index + 1}: duplicate verse ${chapter}:${verse}`);
    let rest = body;
    if (body.startsWith(PROLOGUE)) {
      const start = body.indexOf('[');
      if (start === -1) throw new CorpusError(`${where}:${index + 1}: prologue without a following "["`);
      verses[PROLOGUE_VERSE] = tokeniseVerse(body.slice(PROLOGUE.length, start));
      rest = body.slice(start);
    }
    const tokens = tokeniseVerse(rest);
    if (tokens.length === 0) throw new CorpusError(`${where}:${index + 1}: verse ${chapter}:${verse} has no words`);
    verses[verse] = tokens;
  });
  if (chapters.size === 0) throw new CorpusError(`${where}: no verses`);
  return chapters;
}

/**
 * The upstream licence statement, verbatim from the project website's source (htdocs/index.html, "Copyright and
 * licensing") at commit 48da7db of https://bitbucket.org/clementinetextproject/website. The text repository itself
 * carries no licence file; its README.md is appended to LICENSE.md at import time.
 */
export const LICENCE_STATEMENT =
  'The text has been released into the public domain. Those who use it are requested to acknowledge their ' +
  'source, report typographical errors to the project maintainer, and make clear any modifications they make, ' +
  'but these are only requests that are not enforced by any licence.';

/** The SOURCE.json of the edition. */
export function vulgateSource(archive: PinnedArchive & { readonly version: string }): SourceInfo {
  return {
    name: 'Clementine Vulgate (Clementine Vulgate Project)',
    language: 'lat',
    upstreamUrl: archive.url,
    version: archive.version,
    sha256: archive.sha256,
    licence: 'LicenseRef-PublicDomain',
    attribution:
      'Latin text of the Clementine Vulgate from the Clementine Vulgate Project (https://vulsearch.sourceforge.net/, ' +
      'source https://bitbucket.org/clementinetextproject/text), released into the public domain. Modified for ' +
      'Lectio: markup, speaker labels and headings removed and the text split into words; the prologues of Lamentations and ' +
      'Sirach are stored as verse "prologue" of chapter 1.',
    versification: 'vulgate',
  };
}

function licenceText(archive: PinnedArchive & { readonly version: string }, readme: string): string {
  return [
    '# Clementine Vulgate Project: licence',
    '',
    `Imported from ${archive.url} (commit ${archive.version}, sha256 ${archive.sha256}).`,
    '',
    '## Licence statement',
    '',
    `Verbatim from the project website source, htdocs/index.html at commit ${WEBSITE_COMMIT} of`,
    'https://bitbucket.org/clementinetextproject/website ("Copyright and licensing"):',
    '',
    `> ${LICENCE_STATEMENT}`,
    '',
    '## Modifications',
    '',
    'Lectio removed the markup (paragraph, poetry and line-break marks), split each verse into words, and stored the',
    'prologues of Lamentations and Sirach as verse "prologue" of chapter 1. The speaker labels and headings in angle',
    'brackets were dropped with their words (for example `<Sponsa>` in the Song of Songs, the Hebrew letter names in',
    'Lamentations, and the titles before Lamentations 5 and Baruch 6), so they are not in this edition. Every other',
    'word is unchanged.',
    '',
    `## Upstream README.md (commit ${archive.version})`,
    '',
    readme.replace(/\r\n/gu, '\n').trimEnd(),
    '',
  ].join('\n');
}

export interface ImportVulgateOptions {
  readonly downloader: Downloader;
  /** The corpus directory; the edition is written to `<corpusRoot>/lat-vulgate-clementine`. */
  readonly corpusRoot: string;
  /** Where the downloaded archive is cached (reused when its sha256 still matches). */
  readonly cacheDir: string;
  /** The upstream archive. Defaults to the pinned CLEMENTINE_VULGATE; tests pass a fixture archive. */
  readonly archive?: PinnedArchive & { readonly version: string };
  /** Renames a directory. Defaults to node:fs `rename`; injectable so tests can make the final swap fail. */
  readonly renameDir?: (from: string, to: string) => Promise<void>;
}

export interface ImportSummary {
  readonly edition: string;
  readonly books: number;
  readonly chapters: number;
  readonly verses: number;
}

async function readBooks(dir: string): Promise<Map<string, VulgateBook>> {
  const names = (await readdir(dir)).filter((name) => name.endsWith('.lat')).sort();
  const stems = names.map((name) => name.slice(0, -'.lat'.length));
  const unknown = stems.filter((stem) => !Object.hasOwn(VULGATE_BOOKS, stem));
  if (unknown.length > 0) throw new CorpusError(`unexpected upstream book file(s): ${unknown.join(', ')}`);
  const missing = Object.keys(VULGATE_BOOKS).filter((stem) => !stems.includes(stem));
  if (missing.length > 0) throw new CorpusError(`missing upstream book file(s): ${missing.join(', ')}`);
  const books = new Map<string, VulgateBook>();
  for (const stem of stems) {
    const text = decodeCp1252(await readFile(join(dir, `${stem}.lat`)));
    books.set(VULGATE_BOOKS[stem] as string, parseVulgateBook(text, `${stem}.lat`));
  }
  return books;
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

async function readReadme(dir: string): Promise<string> {
  try {
    return await readFile(join(dir, 'README.md'), 'utf8');
  } catch (error) {
    if (isNotFound(error)) throw new CorpusError('upstream archive has no README.md');
    throw error;
  }
}

/**
 * Moves the staged edition to `target`. An existing edition is first moved to `backup` and moved back if the swap
 * fails, so the corpus always holds either the old or the new edition, never a partial one.
 */
async function swapIn(
  staged: string,
  target: string,
  backup: string,
  renameDir: (from: string, to: string) => Promise<void>,
): Promise<void> {
  let hadOld = true;
  try {
    await renameDir(target, backup);
  } catch (error) {
    if (!isNotFound(error)) throw error;
    hadOld = false;
  }
  try {
    await renameDir(staged, target);
  } catch (error) {
    if (hadOld) await renameDir(backup, target);
    throw error;
  }
}

/**
 * Downloads (or reuses) the pinned archive, verifies its sha256, and rebuilds `corpus/lat-vulgate-clementine` from
 * scratch, so a re-run produces byte-identical files. The edition is written to a staging directory under the corpus
 * root and swapped in only once every file is written; a failure leaves the previous edition in place.
 */
export async function importClementineVulgate(options: ImportVulgateOptions): Promise<ImportSummary> {
  const archive = options.archive ?? CLEMENTINE_VULGATE;
  const cached = join(options.cacheDir, `clementine-vulgate-${archive.version}.tar.gz`);
  await downloadPinned(options.downloader, archive, cached);
  const work = await mkdtemp(join(tmpdir(), 'lectio-vulgate-'));
  try {
    await unpackTarball(cached, work, { strip: 1 });
    const books = await readBooks(work);
    const readme = await readReadme(work);
    await mkdir(options.corpusRoot, { recursive: true });
    const staging = await mkdtemp(join(options.corpusRoot, '.staging-vulgate-'));
    try {
      let chapters = 0;
      let verses = 0;
      for (const [book, content] of books) {
        for (const [chapter, chapterVerses] of content) {
          await writeChapter(staging, VULGATE_EDITION, book, chapter, chapterVerses);
          chapters += 1;
          verses += Object.keys(chapterVerses).filter((key) => key !== PROLOGUE_VERSE).length;
        }
      }
      await writeEditionMetadata(staging, VULGATE_EDITION, vulgateSource(archive), licenceText(archive, readme));
      await swapIn(
        join(staging, VULGATE_EDITION),
        join(options.corpusRoot, VULGATE_EDITION),
        join(staging, 'previous'),
        options.renameDir ?? rename,
      );
      return { edition: VULGATE_EDITION, books: books.size, chapters, verses };
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A Downloader over the Fetch API (Node's global fetch by default). Throws on a non-2xx response. */
export function fetchDownloader(fetchImpl: typeof fetch = globalThis.fetch): Downloader {
  return {
    async fetchBytes(url) {
      let response: Response;
      try {
        response = await fetchImpl(url);
      } catch (error) {
        throw new CorpusError(`GET ${url}: ${errorMessage(error)}`);
      }
      if (!response.ok) throw new CorpusError(`GET ${url}: HTTP ${response.status}`);
      try {
        return new Uint8Array(await response.arrayBuffer());
      } catch (error) {
        throw new CorpusError(`GET ${url}: reading the body failed: ${errorMessage(error)}`);
      }
    },
  };
}

export interface ImportCliIo {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

/**
 * `npm run corpus:import:latin`: imports into `corpusRoot`, caching the archive in `.cache/corpus` next to it (the
 * repository's git-ignored cache). Exit code 0 on success, 2 on a corpus error (bad hash, unexpected upstream layout,
 * network or HTTP error).
 */
export async function runImportVulgate(
  corpusRoot: string,
  io: ImportCliIo,
  {
    downloader = fetchDownloader(),
    archive,
  }: { downloader?: Downloader; archive?: ImportVulgateOptions['archive'] } = {},
): Promise<number> {
  try {
    const cacheDir = join(dirname(corpusRoot), '.cache', 'corpus');
    const summary = await importClementineVulgate({ downloader, corpusRoot, cacheDir, ...(archive && { archive }) });
    io.out(
      `${summary.edition}: ${summary.books} books, ${summary.chapters} chapters, ${summary.verses} verses ` +
        `written to ${join(corpusRoot, summary.edition)}`,
    );
    return 0;
  } catch (error) {
    if (!(error instanceof CorpusError)) throw error;
    io.err(error.message);
    return 2;
  }
}
