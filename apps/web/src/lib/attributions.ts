/**
 * The About page's attribution list, built from data at build time (L-059). Nothing here is hand-maintained per
 * source: adding a corpus edition, a font or a versification source adds an entry with no code change.
 *
 * - Corpus editions: every `corpus/<edition>/SOURCE.json`, through `listLicences` of `@lectio/corpus`. The
 *   `corpus/guard/` directory holds the licence guard's hash index, not an edition; `listLicences` skips it (its
 *   SOURCE.json has no `language`) and `readGuard` reads it instead, for the public-domain Bibles the index was
 *   built from and the guard's stated limitation.
 * - Fonts: every `OFL-*.txt` beside the self-hosted fonts (`apps/web/public/fonts`), with family names and upstream
 *   links from the table in that directory's README.md.
 * - Versification tables: the third-party `sources` of `packages/refs/data/SOURCE.json`.
 * - Lectionary data: the entries of `calendar/lectionary/sources.json` that were imported automatically (LitCal).
 *
 * Everything reads through an injectable `AttributionFs`, so tests run on fixtures or in memory.
 */
import { readFile as fsReadFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { findRepoRoot } from '@lectio/config';
import type { LinkoutConfig } from '@lectio/config';
import { listLicences } from '@lectio/corpus';
import type { Language, LicenceEntry } from '@lectio/corpus';
import { DRBO_BASE, activeProvider } from '@lectio/refs';

/** The project repository: where corpus licence files live and where readers report an issue. */
export const REPO_URL = 'https://github.com/nyabongo/lectio';

/** Where a reader reports a problem with a note or the site. */
export const REPORT_ISSUE_URL = `${REPO_URL}/issues/new/choose`;

/** The corpus directory that holds the licence guard's index rather than an edition. */
export const GUARD_DIR = 'guard';

/** File-system access, injectable for tests. */
export interface AttributionFs {
  /** A UTF-8 file, or undefined when it does not exist. */
  readonly readFile: (path: string) => Promise<string | undefined>;
  /** Names of the sub-directories of a directory ([] when it does not exist). */
  readonly listDirectories: (path: string) => Promise<string[]>;
  /** Names of the plain files in a directory ([] when it does not exist). */
  readonly listFiles: (path: string) => Promise<string[]>;
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTDIR');
}

async function listEntries(path: string, wantDirectories: boolean): Promise<string[]> {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory() === wantDirectories).map((entry) => entry.name);
  } catch (error) {
    if (isNotFound(error)) return [];
    throw error;
  }
}

/** The real file system. */
export const nodeFs: AttributionFs = {
  async readFile(path) {
    try {
      return await fsReadFile(path, 'utf8');
    } catch (error) {
      if (isNotFound(error)) return undefined;
      throw error;
    }
  },
  listDirectories: (path) => listEntries(path, true),
  listFiles: (path) => listEntries(path, false),
};

/** Where each attribution source lives. */
export interface AttributionPaths {
  /** `corpus/` */
  readonly corpusRoot: string;
  /** `apps/web/public/fonts/` */
  readonly fontsDir: string;
  /** `packages/refs/data/SOURCE.json` */
  readonly versificationSource: string;
  /** `calendar/lectionary/sources.json` */
  readonly lectionarySources: string;
}

/** The attribution sources of the repository rooted at `repoRoot`. */
export function attributionPaths(repoRoot: string): AttributionPaths {
  return {
    corpusRoot: join(repoRoot, 'corpus'),
    fontsDir: join(repoRoot, 'apps', 'web', 'public', 'fonts'),
    versificationSource: join(repoRoot, 'packages', 'refs', 'data', 'SOURCE.json'),
    lectionarySources: join(repoRoot, 'calendar', 'lectionary', 'sources.json'),
  };
}

/** One part of an SPDX licence expression, with a link when it is a plain SPDX id. */
export interface LicencePart {
  /** The SPDX id, e.g. `CC-BY-4.0`, or `LicenseRef-PublicDomain`. */
  readonly id: string;
  /** True for `LicenseRef-PublicDomain` (and the plain words "Public Domain"). */
  readonly publicDomain: boolean;
  /** The SPDX licence page, or null for a `LicenseRef-*` or free-text licence. */
  readonly url: string | null;
}

const SPDX_ID = /^[A-Za-z0-9][A-Za-z0-9.+-]*$/;

/** The parts of an SPDX expression such as `CC-BY-4.0 AND LicenseRef-PublicDomain`, in order. */
export function licenceParts(expression: string): LicencePart[] {
  return expression
    .replace(/[()]/g, ' ')
    .split(/\s+(?:AND|OR|WITH)\s+/)
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .map((id) => {
      const publicDomain = /^(?:LicenseRef-PublicDomain|public domain)$/i.test(id);
      const url = !publicDomain && !id.startsWith('LicenseRef-') && SPDX_ID.test(id) ? spdxUrl(id) : null;
      return { id, publicDomain, url };
    });
}

function spdxUrl(id: string): string {
  return `https://spdx.org/licenses/${id}.html`;
}

/** A run of attribution text, emphasised when the source wrapped it in `_underscores_`. */
export interface TextRun {
  readonly text: string;
  readonly em: boolean;
}

/**
 * SOURCE.json attribution text as paragraphs of runs: one paragraph per line, `_title_` as emphasis (the form
 * MorphGNT's citation uses). Everything else is plain text; nothing is interpreted as HTML.
 */
export function attributionParagraphs(text: string): TextRun[][] {
  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line) =>
      line
        .split(/(?<![\w])_([^_\n]+)_(?![\w])/)
        .map((part, index) => ({ text: part, em: index % 2 === 1 }))
        .filter((run) => run.text !== ''),
    );
}

/**
 * The project page behind a pinned upstream archive URL: `https://github.com/o/r/archive/<sha>.tar.gz` and
 * `https://bitbucket.org/o/r/get/<sha>.tar.gz` become `https://github.com/o/r` and `https://bitbucket.org/o/r`.
 * Any other URL is returned unchanged.
 */
export function projectUrl(upstreamUrl: string): string {
  const match =
    /^(https:\/\/(?:github\.com|gitlab\.com|bitbucket\.org)\/[^/]+\/[^/]+)\/(?:archive|get|-\/archive)\//.exec(
      upstreamUrl,
    );
  return match?.[1] ?? upstreamUrl;
}

/** One corpus edition as the About page lists it. */
export interface CorpusAttribution {
  readonly edition: string;
  readonly name: string;
  readonly language: Language;
  readonly licence: string;
  readonly licenceParts: LicencePart[];
  readonly attribution: TextRun[][];
  /** The upstream project page. */
  readonly projectUrl: string;
  /** The pinned upstream archive and its version. */
  readonly upstreamUrl: string;
  readonly version: string;
  /** The edition's LICENSE.md in the Lectio repository. */
  readonly licenceFileUrl: string;
}

export function corpusAttribution(entry: LicenceEntry): CorpusAttribution {
  return {
    edition: entry.edition,
    name: entry.name,
    language: entry.language,
    licence: entry.licence,
    licenceParts: licenceParts(entry.licence),
    attribution: attributionParagraphs(entry.attribution),
    projectUrl: projectUrl(entry.upstreamUrl),
    upstreamUrl: entry.upstreamUrl,
    version: entry.version,
    licenceFileUrl: `${REPO_URL}/blob/main/corpus/${entry.edition}/LICENSE.md`,
  };
}

/** Every corpus edition under `corpusRoot`, in edition-id order (the guard index is not an edition). */
export async function readCorpora(corpusRoot: string, fs: AttributionFs = nodeFs): Promise<CorpusAttribution[]> {
  const entries = await listLicences(corpusRoot, { readFile: fs.readFile, listDirectories: fs.listDirectories });
  return entries.map(corpusAttribution);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJson(text: string, where: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error(`${where}: invalid JSON (${(error as Error).message})`, { cause: error });
  }
}

function requireString(record: Record<string, unknown>, key: string, where: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.trim() === '')
    throw new Error(`${where}: "${key}" must be a non-empty string`);
  return value;
}

function optionalString(record: Record<string, unknown>, key: string, where: string): string | null {
  if (record[key] === undefined || record[key] === null) return null;
  return requireString(record, key, where);
}

function requireArray(record: Record<string, unknown>, key: string, where: string): unknown[] {
  const value = record[key];
  if (!Array.isArray(value)) throw new Error(`${where}: "${key}" must be an array`);
  return value;
}

function requireRecord(value: unknown, where: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${where}: expected an object`);
  return value;
}

async function readJson(path: string, fs: AttributionFs): Promise<unknown> {
  const text = await fs.readFile(path);
  return text === undefined ? undefined : parseJson(text, path);
}

/** A public-domain Bible the licence guard's index was built from. */
export interface GuardEdition {
  readonly title: string;
  readonly homepage: string;
  readonly licence: string;
}

/** What the About page says about the licence guard (gate 3). */
export interface GuardInfo {
  readonly editions: GuardEdition[];
  /** The index's own statement of what it cannot catch. */
  readonly limitation: string;
}

/** `corpus/guard/SOURCE.json`, or null when there is no guard index. */
export async function readGuard(corpusRoot: string, fs: AttributionFs = nodeFs): Promise<GuardInfo | null> {
  const path = join(corpusRoot, GUARD_DIR, 'SOURCE.json');
  const json = await readJson(path, fs);
  if (json === undefined) return null;
  const record = requireRecord(json, path);
  return {
    editions: requireArray(record, 'editions', path).map((item, index) => {
      const where = `${path} editions[${index}]`;
      const edition = requireRecord(item, where);
      return {
        title: requireString(edition, 'title', where),
        homepage: requireString(edition, 'homepage', where),
        licence: requireString(edition, 'licence', where),
      };
    }),
    limitation: requireString(record, 'limitation', path),
  };
}

/** One self-hosted font family and its licence file. */
export interface FontAttribution {
  readonly family: string;
  /** The `OFL-*.txt` file name, served beside the fonts at `fonts/<file>`. */
  readonly file: string;
  /** The copyright line of the licence file. */
  readonly copyright: string;
  /** A Reserved Font Name the licence declares, or null. */
  readonly reservedName: string | null;
  /** The family's upstream project, from the fonts README, or null. */
  readonly upstream: string | null;
}

const OFL_FILE = /^OFL-(.+)\.txt$/;

/** `SourceSans3` → `Source Sans 3`, `NotoSerifHebrew` → `Noto Serif Hebrew`. */
export function familyFromFileStem(stem: string): string {
  return stem
    .replace(/([a-z])([A-Z0-9])/g, '$1 $2')
    .replace(/([0-9])([A-Za-z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .trim();
}

/**
 * The family and upstream of each licence file named in the fonts README's markdown table: a header row with
 * `Family`, `Licence` and `Upstream` columns, and rows whose Licence cell names an `OFL-*.txt` file.
 */
export function parseFontsReadme(markdown: string): Map<string, { family: string; upstream: string | null }> {
  const rows = markdown
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('|') && line.endsWith('|'))
    .map((line) =>
      line
        .slice(1, -1)
        .split('|')
        .map((cell) => cell.trim()),
    );
  const result = new Map<string, { family: string; upstream: string | null }>();
  let columns: { family: number; licence: number; upstream: number } | undefined;
  for (const cells of rows) {
    const lower = cells.map((cell) => cell.toLowerCase());
    if (lower.includes('family') && lower.includes('licence')) {
      columns = {
        family: lower.indexOf('family'),
        licence: lower.indexOf('licence'),
        upstream: lower.indexOf('upstream'),
      };
      continue;
    }
    if (columns === undefined) continue;
    const file = /OFL-[^\s`]+\.txt/.exec(cells[columns.licence] ?? '')?.[0];
    const family = cells[columns.family] ?? '';
    if (file === undefined || family === '') continue;
    const upstream = /https?:\/\/\S+/.exec(cells[columns.upstream] ?? '')?.[0] ?? null;
    result.set(file, { family, upstream });
  }
  return result;
}

/** The copyright line of an OFL file (its first line; per-file repeats such as `X-Bold.ttf: …` are dropped). */
export function oflCopyright(text: string): { copyright: string; reservedName: string | null } {
  const first = text.split('\n').find((line) => line.trim() !== '') ?? '';
  const copyright = (first.split(/\s+\S+\.(?:ttf|otf|woff2?):\s+/)[0] as string).trim();
  const reservedName = /Reserved Font Names? ['"“‘]([^'"”’]+)['"”’]/.exec(text)?.[1] ?? null;
  return { copyright, reservedName };
}

/** Every `OFL-*.txt` in `fontsDir`, sorted by family. */
export async function readFonts(fontsDir: string, fs: AttributionFs = nodeFs): Promise<FontAttribution[]> {
  const files = (await fs.listFiles(fontsDir)).filter((name) => OFL_FILE.test(name));
  const readme = parseFontsReadme((await fs.readFile(join(fontsDir, 'README.md'))) ?? '');
  const fonts = await Promise.all(
    files.map(async (file): Promise<FontAttribution> => {
      const text = (await fs.readFile(join(fontsDir, file))) ?? '';
      const listed = readme.get(file);
      const stem = (OFL_FILE.exec(file) as RegExpExecArray)[1] as string;
      return {
        family: listed?.family ?? familyFromFileStem(stem),
        file,
        ...oflCopyright(text),
        upstream: listed?.upstream ?? null,
      };
    }),
  );
  return fonts.sort((a, b) => a.family.localeCompare(b.family, 'en'));
}

/** A third-party data source (versification tables, lectionary citations). */
export interface DataAttribution {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly licence: string;
  readonly licenceParts: LicencePart[];
  /** A copyright line or bibliography, when the source records one. */
  readonly credit: string | null;
  /** The pinned upstream commit, when the source records one. */
  readonly revision: string | null;
}

/** The third-party sources of `packages/refs/data/SOURCE.json` (Lectio's own supplements are skipped). */
export async function readVersification(path: string, fs: AttributionFs = nodeFs): Promise<DataAttribution[]> {
  const json = await readJson(path, fs);
  if (json === undefined) return [];
  return requireArray(requireRecord(json, path), 'sources', path)
    .map((item, index) => {
      const where = `${path} sources[${index}]`;
      const source = requireRecord(item, where);
      const licence = requireString(source, 'licence', where);
      return {
        id: requireString(source, 'id', where),
        name: requireString(source, 'name', where),
        url: requireString(source, 'url', where),
        licence,
        licenceParts: licenceParts(licence),
        credit: optionalString(source, 'copyright', where),
        revision: optionalString(source, 'commit', where),
      };
    })
    .filter((source) => !source.url.startsWith(REPO_URL));
}

/** The automatically imported sources of `calendar/lectionary/sources.json` (citation-only sources are skipped). */
export async function readLectionarySources(path: string, fs: AttributionFs = nodeFs): Promise<DataAttribution[]> {
  const json = await readJson(path, fs);
  if (json === undefined) return [];
  const sources = requireRecord(requireRecord(json, path).sources, `${path} sources`);
  return Object.entries(sources)
    .filter(([, value]) => isRecord(value) && value.automatedRetrieval === true)
    .map(([id, value]) => {
      const where = `${path} sources.${id}`;
      const source = value as Record<string, unknown>;
      const licence = requireString(source, 'licence', where);
      return {
        id,
        name: requireString(source, 'title', where),
        url: requireString(source, 'url', where),
        licence,
        licenceParts: licenceParts(licence),
        credit: optionalString(source, 'bibliography', where),
        revision: optionalString(source, 'pinned', where),
      };
    });
}

/** The site the reading text opens at. */
export interface LinkoutCredit {
  readonly label: string;
  /** The provider's home page (the origin of its URLs). */
  readonly url: string;
}

/** The active link-out provider of `linkout` and its home page. */
export function linkoutCredit(linkout: LinkoutConfig): LinkoutCredit {
  const provider = activeProvider(linkout);
  const base = provider.builtin === 'drbo' ? DRBO_BASE : (provider.template ?? '');
  let url: string;
  try {
    url = `${new URL(base).origin}/`;
  } catch (error) {
    throw new Error(`link-out provider "${linkout.provider}" has no usable URL`, { cause: error });
  }
  return { label: provider.label, url };
}

/** Everything the About page credits. */
export interface Attributions {
  readonly corpora: CorpusAttribution[];
  readonly guard: GuardInfo | null;
  readonly fonts: FontAttribution[];
  readonly versification: DataAttribution[];
  readonly lectionary: DataAttribution[];
}

/** Reads every attribution source. */
export async function loadAttributions(paths: AttributionPaths, fs: AttributionFs = nodeFs): Promise<Attributions> {
  const [corpora, guard, fonts, versification, lectionary] = await Promise.all([
    readCorpora(paths.corpusRoot, fs),
    readGuard(paths.corpusRoot, fs),
    readFonts(paths.fontsDir, fs),
    readVersification(paths.versificationSource, fs),
    readLectionarySources(paths.lectionarySources, fs),
  ]);
  return { corpora, guard, fonts, versification, lectionary };
}

/**
 * The attribution sources of the repository the build runs in: the nearest npm-workspaces root above
 * `$INIT_CWD` (set by npm), else above `cwd`.
 */
export function siteAttributionPaths(
  env: Readonly<Record<string, string | undefined>> = process.env,
  cwd: string = process.cwd(),
): AttributionPaths {
  return attributionPaths(findRepoRoot(resolve(env.INIT_CWD ?? cwd)));
}
