/**
 * Importer for the SBL Greek New Testament with MorphGNT lemmas and parsing codes (`morphgnt/sblgnt`), written to
 * `corpus/grc-sblgnt` (`npm run corpus:import:greek`, wrapper: scripts/corpus/import-greek.mjs).
 *
 * The upstream repository has one file per book (`61-Mt-morphgnt.txt` … `87-Re-morphgnt.txt`) with one word per
 * line and seven space-separated columns:
 *
 * ```
 * 012015 A- ----NSM- πονηρός πονηρός πονηρός πονηρός
 * BBCCVV pos parse    text    word    normalized lemma
 * ```
 *
 * `BB` is the book's position in the New Testament (01 Matthew … 27 Revelation), which is mapped to the L-005 book
 * code. Each token is stored as `[text, lemma, "<pos> <parse>"]`: the text column keeps the SBLGNT's punctuation and
 * text-critical sigla (⸀ ⸂ ⸃), which the Greek normaliser ignores when words are compared.
 */
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { BOOKS } from '@lectio/refs';

import { resolveCorpusRoot } from '../cli/run.ts';
import type { CliIo } from '../cli/run.ts';
import { CorpusError } from '../format.ts';
import type { SourceInfo, Token } from '../format.ts';
import { downloadPinned } from '../import/download.ts';
import type { Downloader, PinnedArchive } from '../import/download.ts';
import { unpackTarball, writeChapter, writeEditionMetadata } from '../import/unpack.ts';
import { corpusDownloader, replaceEdition } from './shared.ts';

export const SBLGNT_EDITION = 'grc-sblgnt';

/** The pinned upstream commit of https://github.com/morphgnt/sblgnt (merge of PR #68, 2024-01-21). */
export const MORPHGNT_SBLGNT_COMMIT = 'aaed91e57c8e4a8dc9a2383e129ca5e75fe6393d';

/**
 * GitHub's archive of the pinned commit and its sha256 (the archive unpacks to `sblgnt-<commit>/`). Upstream
 * publishes no release assets (its tags have none), so the generated archive is the pin. GitHub does not promise that
 * generated archives stay byte-identical: if it regenerates this one, the sha256 check refuses it and the import
 * stops without touching the corpus. The fallback is then to check the new archive's tree against the pinned commit
 * (`git archive` of a clone at that commit, or the per-file blob hashes of its tree) and, if it matches, record the
 * new sha256 here.
 */
export const MORPHGNT_SBLGNT_ARCHIVE: PinnedArchive = {
  url: `https://github.com/morphgnt/sblgnt/archive/${MORPHGNT_SBLGNT_COMMIT}.tar.gz`,
  sha256: 'e760c941eebae0eb25665a4937cf3b29b04a842f952f4b46d4181601d0e91872',
};

/** When the current licence page of the SBLGNT (linked from the upstream README) was checked. */
export const SBLGNT_LICENCE_CHECKED = '2026-10-05';

/** L-005 book codes in MorphGNT order: index 0 is book `01` (Matthew), index 26 is book `27` (Revelation). */
export const MORPHGNT_BOOK_CODES: readonly string[] = BOOKS.filter((book) => book.testament === 'NT').map(
  (book) => book.code,
);

/** The L-005 code of MorphGNT book number `n` (1–27). */
export function morphgntBookCode(n: number): string {
  const code = Number.isInteger(n) ? MORPHGNT_BOOK_CODES[n - 1] : undefined;
  if (code === undefined) throw new CorpusError(`unknown MorphGNT book number: ${n}`);
  return code;
}

export interface MorphgntWord {
  /** MorphGNT book number, 1–27. */
  readonly book: number;
  readonly chapter: number;
  readonly verse: number;
  readonly token: Token;
}

const REF = /^(\d{2})(\d{2})(\d{2})$/;
const POS = /^[A-Z][A-Z-]$/;
const PARSE = /^[0-9A-Z-]{8}$/;

/** Parses one line of a MorphGNT book file. `where` names the file and line in error messages. */
export function parseMorphgntLine(line: string, where: string): MorphgntWord {
  const fields = line.split(' ');
  const [ref, pos, parse, text, , , lemma] = fields;
  const match = REF.exec(ref as string);
  if (fields.length !== 7 || match === null || fields.some((field) => field === '')) {
    throw new CorpusError(`${where}: expected "BBCCVV pos parse text word normalized lemma"`);
  }
  const [book, chapter, verse] = match.slice(1).map(Number) as [number, number, number];
  if (chapter === 0 || verse === 0) throw new CorpusError(`${where}: invalid reference ${ref}`);
  if (!POS.test(pos as string) || !PARSE.test(parse as string)) {
    throw new CorpusError(`${where}: invalid part of speech or parsing code "${pos} ${parse}"`);
  }
  return { book, chapter, verse, token: [text as string, lemma as string, `${pos} ${parse}`] };
}

/** Chapter number → verse number (as a string) → tokens. */
export type BookVerses = Map<number, Record<string, Token[]>>;

/** Parses a whole book file and checks every line belongs to MorphGNT book `book`. */
export function parseMorphgntBook(text: string, book: number, where: string): BookVerses {
  const chapters: BookVerses = new Map();
  text.split('\n').forEach((line, index) => {
    if (line.trim() === '') return;
    const lineWhere = `${where}:${index + 1}`;
    const word = parseMorphgntLine(line.replace(/\r$/u, ''), lineWhere);
    if (word.book !== book) throw new CorpusError(`${lineWhere}: book ${word.book} in the file of book ${book}`);
    const verses = chapters.get(word.chapter) ?? {};
    chapters.set(word.chapter, verses);
    (verses[String(word.verse)] ??= []).push(word.token);
  });
  if (chapters.size === 0) throw new CorpusError(`${where}: no words`);
  return chapters;
}

/** The README paragraph that starts with `start`, verbatim (line breaks kept). */
function readmeParagraph(readme: string, start: string, what: string): string {
  const paragraph = readme
    .replace(/\r\n/gu, '\n')
    .split(/\n\s*\n/u)
    .find((block) => block.startsWith(start));
  if (paragraph === undefined) throw new CorpusError(`upstream README.md: ${what} not found`);
  return paragraph.trimEnd();
}

export interface UpstreamStatements {
  /** The upstream licence statement, verbatim. */
  readonly licence: string;
  /** The upstream "How to cite" text, verbatim. */
  readonly citation: string;
}

/** Extracts the licence statement and the citation from the upstream README.md. */
export function readUpstreamStatements(readme: string): UpstreamStatements {
  return {
    licence: readmeParagraph(readme, 'The SBLGNT text itself', 'the licence statement'),
    citation: readmeParagraph(readme, 'Tauber, J. K.', 'the "How to cite" text'),
  };
}

const SBLGNT_ATTRIBUTION =
  'Scripture quotations marked SBLGNT are from the SBL Greek New Testament. ' +
  'Copyright © 2010 Society of Biblical Literature and Logos Bible Software.';

/** The edition's SOURCE.json. */
export function sblgntSource(archive: PinnedArchive, commit: string, statements: UpstreamStatements): SourceInfo {
  return {
    name: 'SBL Greek New Testament (MorphGNT SBLGNT edition)',
    language: 'grc',
    upstreamUrl: archive.url,
    version: commit,
    sha256: archive.sha256,
    licence: 'CC-BY-4.0 AND CC-BY-SA-3.0',
    attribution:
      `Text: ${SBLGNT_ATTRIBUTION} Licensed under CC BY 4.0.\n` +
      `Lemmas and morphology: MorphGNT, licensed under CC BY-SA 3.0. ${statements.citation.replace(/\s*\n\s*/gu, ' ')}`,
    versification: 'original',
  };
}

function quote(text: string): string {
  return text
    .split('\n')
    .map((line) => (line === '' ? '>' : `> ${line}`))
    .join('\n');
}

/** The edition's LICENSE.md: the upstream statements verbatim, then what they mean for these files. */
export function sblgntLicenceMarkdown(archive: PinnedArchive, commit: string, statements: UpstreamStatements): string {
  return `# Licence: SBL Greek New Testament (MorphGNT SBLGNT edition)

The files in this directory are generated by \`npm run corpus:import:greek\` from
[morphgnt/sblgnt](https://github.com/morphgnt/sblgnt) at commit \`${commit}\`
(archive ${archive.url}, sha256 \`${archive.sha256}\`). Do not edit them by hand.

## Upstream licence statement

Verbatim from \`README.md\` at the pinned commit:

${quote(statements.licence)}

## What applies to these files

- **SBLGNT text** (the surface forms): the licence page the statement links to, http://sblgnt.com/license/, now
  publishes the SBL Greek New Testament under the Creative Commons Attribution 4.0 International licence
  (CC BY 4.0, https://creativecommons.org/licenses/by/4.0/), replacing the earlier end-user licence agreement
  (checked ${SBLGNT_LICENCE_CHECKED}).
- **MorphGNT lemmas and parsing codes**: Creative Commons Attribution-ShareAlike 3.0 Unported (CC BY-SA 3.0,
  https://creativecommons.org/licenses/by-sa/3.0/).
- **ShareAlike**: every chapter file combines the text with MorphGNT lemmas and parsing codes, so the corpus files
  in this directory are an adaptation of CC BY-SA 3.0 material and are distributed under CC BY-SA 3.0, with the
  attribution CC BY 4.0 requires for the SBLGNT text. Anything adapted from these files must carry the same terms.
  This applies to the corpus files only, not to the rest of the Lectio repository.

## Attribution

${SBLGNT_ATTRIBUTION}

Lemmas and morphology from MorphGNT. How to cite, verbatim from the upstream README:

${quote(statements.citation)}
`;
}

export interface ImportStats {
  readonly books: number;
  readonly chapters: number;
  readonly verses: number;
  readonly words: number;
}

const BOOK_FILE = /^(\d{2})-[A-Za-z0-9]+-morphgnt\.txt$/u;

/** Finds the 27 book files of an unpacked upstream tree, keyed by MorphGNT book number. */
async function bookFiles(sourceDir: string): Promise<Map<number, string>> {
  const files = new Map<number, string>();
  for (const name of (await readdir(sourceDir)).sort()) {
    const match = BOOK_FILE.exec(name);
    if (match === null) continue;
    const book = Number(match[1]) - 60;
    morphgntBookCode(book);
    if (files.has(book)) throw new CorpusError(`two upstream files for MorphGNT book ${book}: ${name}`);
    files.set(book, name);
  }
  const missing = MORPHGNT_BOOK_CODES.filter((_, index) => !files.has(index + 1));
  if (missing.length > 0) throw new CorpusError(`upstream book file(s) missing for ${missing.join(', ')}`);
  return files;
}

export interface ImportTreeOptions {
  readonly archive: PinnedArchive;
  readonly commit: string;
}

/**
 * Imports an unpacked upstream tree into `<root>/grc-sblgnt`. Everything is parsed and validated before anything is
 * written; the edition is then built in a staging directory and swapped in as a whole (see `replaceEdition`), so a
 * failure never leaves a partial edition, re-running gives byte-identical files, and no stale chapter survives.
 */
export async function importMorphgntTree(
  sourceDir: string,
  root: string,
  options: ImportTreeOptions,
): Promise<ImportStats> {
  const statements = readUpstreamStatements(await readFile(join(sourceDir, 'README.md'), 'utf8'));
  const books: [string, BookVerses][] = [];
  for (const [book, name] of await bookFiles(sourceDir)) {
    const text = await readFile(join(sourceDir, name), 'utf8');
    books.push([morphgntBookCode(book), parseMorphgntBook(text, book, name)]);
  }
  return replaceEdition(root, SBLGNT_EDITION, async (staging) => {
    await writeEditionMetadata(
      staging,
      SBLGNT_EDITION,
      sblgntSource(options.archive, options.commit, statements),
      sblgntLicenceMarkdown(options.archive, options.commit, statements),
    );
    let chapters = 0;
    let verses = 0;
    let words = 0;
    for (const [code, bookVerses] of books) {
      for (const [chapter, chapterVerses] of bookVerses) {
        await writeChapter(staging, SBLGNT_EDITION, code, chapter, chapterVerses);
        chapters += 1;
        for (const tokens of Object.values(chapterVerses)) {
          verses += 1;
          words += tokens.length;
        }
      }
    }
    return { books: books.length, chapters, verses, words };
  });
}

export interface ImportSblgntOptions {
  readonly downloader: Downloader;
  /** The corpus root (`<repo>/corpus`). */
  readonly root: string;
  /** Where the downloaded archive is kept between runs. */
  readonly cacheDir: string;
  readonly archive?: PinnedArchive;
  readonly commit?: string;
}

/** Downloads (or reuses) the pinned archive, verifies its sha256, unpacks it and imports it. */
export async function importSblgnt(options: ImportSblgntOptions): Promise<ImportStats> {
  const archive = options.archive ?? MORPHGNT_SBLGNT_ARCHIVE;
  const commit = options.commit ?? MORPHGNT_SBLGNT_COMMIT;
  const archivePath = join(options.cacheDir, `morphgnt-sblgnt-${commit}.tar.gz`);
  await downloadPinned(options.downloader, archive, archivePath);
  const work = await mkdtemp(join(tmpdir(), 'lectio-morphgnt-'));
  try {
    await unpackTarball(archivePath, work, { strip: 1 });
    return await importMorphgntTree(work, options.root, { archive, commit });
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

export interface RunImportGreekDeps {
  /** The live downloader (`LiveDownloader` from `@lectio/provider-fetch`, injected by the script) or a fake. */
  readonly downloader: Downloader;
  readonly archive?: PinnedArchive;
  readonly commit?: string;
}

/**
 * The logic behind `npm run corpus:import:greek`: imports into the corpus root (see `resolveCorpusRoot`) and caches
 * the archive in `<corpus root>/../.cache/corpus` (git-ignored). Returns the exit code: 0, or 1 on a corpus error.
 */
export async function runImportGreek(
  env: NodeJS.ProcessEnv,
  cwd: string,
  io: CliIo,
  deps: RunImportGreekDeps,
): Promise<number> {
  const root = resolveCorpusRoot(env, cwd);
  try {
    const stats = await importSblgnt({
      downloader: corpusDownloader(deps.downloader),
      root,
      cacheDir: join(dirname(root), '.cache', 'corpus'),
      ...(deps.archive === undefined ? {} : { archive: deps.archive }),
      ...(deps.commit === undefined ? {} : { commit: deps.commit }),
    });
    io.out(
      `${SBLGNT_EDITION}: ${stats.books} books, ${stats.chapters} chapters, ${stats.verses} verses, ` +
        `${stats.words} words → ${join(root, SBLGNT_EDITION)}`,
    );
    return 0;
  } catch (error) {
    if (!(error instanceof CorpusError)) throw error;
    io.err(error.message);
    return 1;
  }
}
