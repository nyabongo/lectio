/**
 * Gate `licence` (Licence guard, gate 3, L-026): no long verbatim run from an English Bible
 * translation or from a cited commentary.
 *
 * Lectio carries commentary, never the reading text (ADR 0003): readers open the text at a
 * licensed source. Over every changed passage file the gate checks
 *
 * - `licence/quoted-english-run`: no quoted English span in the note is longer than
 *   `licenceGuard.maxQuotedWords`;
 * - `licence/pd-bible-overlap`: no run of `licenceGuard.maxBibleRunWords` or more words matches the
 *   hash-only shingle index of public-domain English Bibles (L-013, `corpus/guard/en-pd-<n>.bin`);
 * - `licence/commentary-overlap`: no run longer than `licenceGuard.maxCommentaryRunWords` matches the
 *   fetched text of a cited web source; a source that cannot be fetched or read is flagged
 *   `licence/commentary-unchecked` (needs review), never passed;
 * - `licence/excerpt-length`: no source excerpt is longer than `licenceGuard.maxExcerptWords`.
 *
 * Translations (`passages/i18n/<locale>/<key>.json`, and any other file in a subdirectory of
 * passages/, matched in any letter case, so a misplaced file is scanned too) get the checks that
 * mean something for them: `licence/pd-bible-overlap` (English Bible wording pasted into a
 * translation), `licence/commentary-overlap` against the web sources of the English passage they
 * translate (both the key their file name promises and their `translationOf`) and
 * `licence/excerpt-length`. Their quoted-run limit is gate 1's `schema/translation-quoted-run`.
 *
 * Every limit comes from the config. The index only detects public-domain English wording; the
 * gate repeats that limitation (`LIMITATION`, and `TRANSLATION_LIMITATION` when a translation
 * changed) in its output.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { LicenceGuardConfig } from '@lectio/config';
import type { FetchedSource, SourceFetcher } from '@lectio/providers';
import { LIMITATION, NORMALISER_VERSION, loadIndex, longestRun } from '@lectio/textguard';
import type { ShingleIndex } from '@lectio/textguard';
import { PASSAGE_KEY_PATTERN } from '@lectio/schema/common';

import type { Gate, GateContext } from '../core/gate.ts';
import { finding, resultFromFindings } from '../core/result.ts';
import type { GateResultItem } from '../core/result.ts';
import { defineRule } from '../core/rules.ts';
import { indexSourceWords, longestSharedRun, readableText } from './overlap.ts';
import type { SourceWords } from './overlap.ts';
import { englishWordCount, excerptFields, noteFields, preview, quotedSpans, webSources, wordCount } from './text.ts';
import type { NoteField, WebSourceRef } from './text.ts';

export { LIMITATION };

/** What the licence gate cannot see in a translation; repeated in its output when one changed. */
export const TRANSLATION_LIMITATION =
  'The public-domain index holds English Bibles only, so a modern Bible translation in another language ' +
  '(for example a Kiswahili Bible) copied into a translation without quotation marks is caught by nothing ' +
  'automated. For translations the safeguard is the mandatory human review (merge-rule/translation-needs-person, ' +
  'schema/translation-needs-review); gate 1 applies the quoted-run limit (schema/translation-quoted-run).';

const WHY =
  'Lectio never reproduces a Bible translation or a commentary: it links out for the text and writes its own notes.';

export const LICENCE_RULES = {
  quotedEnglishRun: defineRule(
    'licence/quoted-english-run',
    'A quoted English span in a passage note is at most licenceGuard.maxQuotedWords words long.',
    'Quote a single word or a short phrase, or say it in your own words; the reading itself is linked out, never quoted at length.',
  ),
  pdBibleOverlap: defineRule(
    'licence/pd-bible-overlap',
    'No note or translation text shares a run of licenceGuard.maxBibleRunWords or more words with a public-domain English Bible (World English Bible, Douay-Rheims).',
    'Rewrite the sentence in your own words and point to the verse by reference instead of reproducing its wording.',
  ),
  commentaryOverlap: defineRule(
    'licence/commentary-overlap',
    'No note or translation text shares a run of more than licenceGuard.maxCommentaryRunWords words with the fetched text of a web source cited by the passage (for a translation, by the English passage it translates).',
    'Paraphrase the commentary in your own words; keep the source in sources[] and, if needed, a short excerpt.',
  ),
  commentaryUnchecked: defineRule(
    'licence/commentary-unchecked',
    'Every cited web source can be fetched and read, so the note can be checked against it.',
    'Fix the URL or add an archivedUrl that loads; otherwise a reviewer must compare the note with the source by hand.',
  ),
  excerptLength: defineRule(
    'licence/excerpt-length',
    'A source excerpt is at most licenceGuard.maxExcerptWords words long.',
    'Trim the excerpt to the few words that support the claim.',
  ),
  guardIndex: defineRule(
    'licence/guard-index',
    'The public-domain shingle index loads and matches the configured shingle size and the textguard normaliser version, and licenceGuard.maxBibleRunWords is at least the shingle size.',
    'Rebuild the index with `npm run guard:build` (packages/textguard) and commit corpus/guard/ together, or fix licenceGuard in config.',
  ),
} as const;

/** Repository-relative path of the shingle index for shingle size `n`. */
export function guardIndexPath(shingleSize: number): string {
  return `corpus/guard/en-pd-${String(shingleSize)}.bin`;
}

/** Loads the shingle index for a run. */
export type GuardIndexLoader = (context: GateContext) => ShingleIndex;

const indexCache = new Map<string, ShingleIndex>();

/** Reads `corpus/guard/en-pd-<n>.bin` under the PR head, once per process and path. */
export const fileGuardIndexLoader: GuardIndexLoader = (context) => {
  const path = join(context.root, guardIndexPath(context.config.licenceGuard.shingleSize));
  let index = indexCache.get(path);
  if (index === undefined) {
    index = loadIndex(new Uint8Array(readFileSync(path)));
    indexCache.set(path, index);
  }
  return index;
};

export interface LicenceGateOptions {
  /** Defaults to {@link fileGuardIndexLoader}. */
  readonly loadGuardIndex?: GuardIndexLoader;
}

/** The content-root prefix: `.` → `""`, `./content/` → `"content/"`. */
function contentPrefix(context: GateContext): string {
  const root = context.config.content.root.replace(/^\.\/?/u, '').replace(/\/$/u, '');
  return root === '' ? '' : `${root}/`;
}

/**
 * The changed JSON files under passages/ (deleted files excluded), matched in any letter case so
 * that `passages/I18N/…` or `PASSAGES/x.JSON` is scanned too (gate 1 rejects those paths): files
 * directly in it are passages, files in any subdirectory are translations.
 */
function changedContent(context: GateContext): { passages: string[]; translations: string[] } {
  const base = `${contentPrefix(context)}passages/`.toLowerCase();
  const passages: string[] = [];
  const translations: string[] = [];
  for (const file of context.changedFiles) {
    const lower = file.path.toLowerCase();
    if (file.status === 'deleted' || !lower.startsWith(base) || !lower.endsWith('.json')) continue;
    (lower.slice(base.length).includes('/') ? translations : passages).push(file.path);
  }
  return { passages, translations };
}

const PASSAGE_KEY = new RegExp(PASSAGE_KEY_PATTERN);

/**
 * The English passages whose sources a translation is checked against: the key its file name
 * promises and its `translationOf`, each only when it is a passage key.
 */
function englishKeysOf(file: string, translation: unknown): string[] {
  const name = file.slice(file.lastIndexOf('/') + 1).slice(0, -'.json'.length);
  const of = (translation as Record<string, unknown> | null)?.['translationOf'];
  return [...new Set([name, of])].filter((key): key is string => typeof key === 'string' && PASSAGE_KEY.test(key));
}

/** The web sources of the English passages a translation translates, each tagged with its file. */
function englishSources(context: GateContext, file: string, translation: unknown): CitedSource[] {
  return englishKeysOf(file, translation).flatMap((key) => {
    const from = `${contentPrefix(context)}passages/${key}.json`;
    return webSources(parse(context.readFile(from))).map((source) => ({ ...source, from }));
  });
}

function parse(text: string | null): unknown {
  if (text === null) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

const words = (n: number): string => `${String(n)} word${n === 1 ? '' : 's'}`;

function claimOf(field: NoteField): { claimId?: string } {
  return field.claimId === undefined ? {} : { claimId: field.claimId };
}

function checkQuotes(file: string, fields: readonly NoteField[], limits: LicenceGuardConfig): GateResultItem[] {
  const items: GateResultItem[] = [];
  for (const field of fields) {
    for (const span of quotedSpans(field.text)) {
      const count = englishWordCount(field.text.slice(span.start, span.end));
      if (count <= limits.maxQuotedWords) continue;
      const open = span.unterminated ? ' (the quotation is never closed, so it runs to the end of the text)' : '';
      items.push(
        finding(LICENCE_RULES.quotedEnglishRun, {
          file,
          pointer: field.pointer,
          ...claimOf(field),
          message:
            `quotes ${words(count)} of English (limit ${String(limits.maxQuotedWords)})${open}: ` +
            `“${preview(field.text, span.start, span.end)}”. ${WHY}`,
        }),
      );
    }
  }
  return items;
}

function checkBible(
  file: string,
  fields: readonly NoteField[],
  index: ShingleIndex,
  limits: LicenceGuardConfig,
): GateResultItem[] {
  const items: GateResultItem[] = [];
  for (const field of fields) {
    const run = longestRun(field.text, index);
    if (run.words < limits.maxBibleRunWords) continue;
    items.push(
      finding(LICENCE_RULES.pdBibleOverlap, {
        file,
        pointer: field.pointer,
        ...claimOf(field),
        message:
          `${words(run.words)} match a public-domain English Bible word for word ` +
          `(limit: fewer than ${String(limits.maxBibleRunWords)}): “${preview(field.text, run.start, run.end)}”. ${WHY}`,
      }),
    );
  }
  return items;
}

function checkExcerpts(file: string, passage: unknown, limits: LicenceGuardConfig): GateResultItem[] {
  const items: GateResultItem[] = [];
  for (const excerpt of excerptFields(passage)) {
    const count = wordCount(excerpt.text);
    if (count <= limits.maxExcerptWords) continue;
    items.push(
      finding(LICENCE_RULES.excerptLength, {
        file,
        pointer: excerpt.pointer,
        message:
          `the excerpt of source ${excerpt.sourceId} is ${words(count)} long (limit ${String(limits.maxExcerptWords)}). ` +
          'An excerpt only shows where the claim comes from; a longer one starts to reproduce the source.',
      }),
    );
  }
  return items;
}

/** A web source to check against; `from` names the English passage that cites it, for a translation. */
type CitedSource = WebSourceRef & { readonly from?: string };

/** A fetched source, prepared, or why it could not be checked. */
type SourceOutcome = { readonly words: SourceWords; readonly via: string } | { readonly problem: string };

function describeError(error: unknown): string {
  const text = (error instanceof Error ? error.message : String(error)).replace(/\s+/gu, ' ').trim();
  return `fetching or reading the page failed: ${text === '' ? '(no message)' : text}`;
}

/**
 * Fetches and prepares one source. Never rejects: a failure anywhere (the fetch, reading the
 * page, indexing it) becomes a problem, so the source is flagged unchecked and the promises the
 * gate creates up front can never reject unhandled.
 */
async function fetchSource(fetcher: SourceFetcher, source: WebSourceRef): Promise<SourceOutcome> {
  try {
    const page: FetchedSource = await fetcher.fetch(
      source.url,
      source.archivedUrl === undefined ? {} : { archivedUrl: source.archivedUrl },
    );
    const readable = readableText(page);
    if ('problem' in readable) return readable;
    return { words: indexSourceWords(readable.text), via: page.fromArchive === true ? ' (archived copy)' : '' };
  } catch (error) {
    return { problem: describeError(error) };
  }
}

async function checkCommentary(
  file: string,
  cited: readonly CitedSource[],
  fields: readonly NoteField[],
  fetcher: SourceFetcher,
  cache: Map<string, Promise<SourceOutcome>>,
  limits: LicenceGuardConfig,
): Promise<{ items: GateResultItem[]; checked: number }> {
  const items: GateResultItem[] = [];
  const byUrl = new Map<string, CitedSource[]>();
  for (const source of cited) {
    const key = `${source.url}\0${source.archivedUrl ?? ''}`;
    byUrl.set(key, [...(byUrl.get(key) ?? []), source]);
    if (!cache.has(key)) cache.set(key, fetchSource(fetcher, source));
  }
  let checked = 0;
  for (const [key, sources] of byUrl) {
    const outcome = await (cache.get(key) as Promise<SourceOutcome>);
    const first = sources[0] as CitedSource;
    if ('problem' in outcome) {
      for (const source of sources) {
        const of = source.from === undefined ? '' : ` of ${source.from}`;
        items.push(
          finding(LICENCE_RULES.commentaryUnchecked, {
            file,
            pointer: source.from === undefined ? source.pointer : '',
            severity: 'warning',
            message:
              `source ${source.sourceId}${of} (${source.url}) could not be checked for copied wording: ${outcome.problem}. ` +
              'An unchecked source never passes silently; a reviewer must compare the note with it.',
          }),
        );
      }
      continue;
    }
    checked++;
    const ids =
      sources.map((source) => source.sourceId).join(', ') + (first.from === undefined ? '' : ` in ${first.from}`);
    for (const field of fields) {
      const run = longestSharedRun(field.text, outcome.words);
      if (run.words <= limits.maxCommentaryRunWords) continue;
      items.push(
        finding(LICENCE_RULES.commentaryOverlap, {
          file,
          pointer: field.pointer,
          ...claimOf(field),
          message:
            `${words(run.words)} are copied from ${first.url}${outcome.via} (cited as ${ids}; ` +
            `limit ${String(limits.maxCommentaryRunWords)}): “${preview(field.text, run.start, run.end)}”. ${WHY}`,
        }),
      );
    }
  }
  return { items, checked };
}

function loadGuard(
  context: GateContext,
  loader: GuardIndexLoader,
): { readonly index: ShingleIndex } | { readonly problem: string } {
  const { shingleSize } = context.config.licenceGuard;
  let index: ShingleIndex;
  try {
    index = loader(context);
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    return { problem: `cannot load ${guardIndexPath(shingleSize)}: ${text}` };
  }
  if (index.shingleSize !== shingleSize) {
    return {
      problem: `the index uses ${String(index.shingleSize)}-word shingles but licenceGuard.shingleSize is ${String(shingleSize)}`,
    };
  }
  if (index.normaliserVersion !== NORMALISER_VERSION) {
    return {
      problem: `the index was built with normaliser version ${String(index.normaliserVersion)}, textguard is at ${String(NORMALISER_VERSION)}`,
    };
  }
  return { index };
}

async function run(context: GateContext, loader: GuardIndexLoader) {
  const limits = context.config.licenceGuard;
  const { passages, translations } = changedContent(context);
  const meta = {
    files: passages.length + translations.length,
    translations: translations.length,
    limits: { ...limits },
    limitation: LIMITATION,
    ...(translations.length === 0 ? {} : { translationLimitation: TRANSLATION_LIMITATION }),
  };
  if (meta.files === 0) return resultFromFindings('licence', [], meta);

  const items: GateResultItem[] = [];
  const guard = loadGuard(context, loader);
  if ('problem' in guard) {
    items.push(
      finding(LICENCE_RULES.guardIndex, {
        message: `${guard.problem}. Without the index no note can be checked against public-domain Bible wording.`,
      }),
    );
  }
  if (limits.maxBibleRunWords < limits.shingleSize) {
    items.push(
      finding(LICENCE_RULES.guardIndex, {
        message:
          `config error: licenceGuard.maxBibleRunWords (${String(limits.maxBibleRunWords)}) is below ` +
          `licenceGuard.shingleSize (${String(limits.shingleSize)}). The index cannot see a run shorter than one ` +
          'shingle, so the real limit would silently be the shingle size. Raise maxBibleRunWords or rebuild the index ' +
          'with a smaller shingle size.',
      }),
    );
  }
  const cache = new Map<string, Promise<SourceOutcome>>();
  let sourcesChecked = 0;
  const files = [
    ...passages.map((file) => ({ file, translation: false })),
    ...translations.map((file) => ({ file, translation: true })),
  ];
  for (const { file, translation } of files) {
    const value = parse(context.readFile(file));
    if (value === undefined) continue; // unreadable JSON is the schema gate's finding
    const fields = noteFields(value);
    // A translation's quoted-run limit is gate 1's schema/translation-quoted-run.
    if (!translation) items.push(...checkQuotes(file, fields, limits));
    if ('index' in guard) items.push(...checkBible(file, fields, guard.index, limits));
    const cited = translation ? englishSources(context, file, value) : webSources(value);
    const commentary = await checkCommentary(file, cited, fields, context.providers.fetcher, cache, limits);
    items.push(...commentary.items);
    sourcesChecked += commentary.checked;
    items.push(...checkExcerpts(file, value, limits));
  }
  items.push(finding(LICENCE_RULES.pdBibleOverlap, { severity: 'info', message: `Limitation: ${LIMITATION}` }));
  if (translations.length > 0) {
    items.push(
      finding(LICENCE_RULES.pdBibleOverlap, {
        severity: 'info',
        message: `Limitation (translations): ${TRANSLATION_LIMITATION}`,
      }),
    );
  }
  return resultFromFindings('licence', items, { ...meta, sourcesFetched: cache.size, sourcesChecked });
}

/** The licence gate with injectable dependencies (tests pass their own index). */
export function createLicenceGate(options: LicenceGateOptions = {}): Gate {
  const loader = options.loadGuardIndex ?? fileGuardIndexLoader;
  return {
    id: 'licence',
    title: 'Licence guard',
    rules: Object.values(LICENCE_RULES),
    run: (context) => run(context, loader),
  };
}

export const licenceGate: Gate = createLicenceGate();
