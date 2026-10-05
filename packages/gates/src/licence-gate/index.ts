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
 * Every limit comes from the config. The index only detects public-domain wording; the gate
 * repeats that limitation (`LIMITATION`) in its output.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { LicenceGuardConfig } from '@lectio/config';
import { contentKindOf } from '@lectio/content';
import type { FetchedSource, SourceFetcher } from '@lectio/providers';
import { LIMITATION, NORMALISER_VERSION, loadIndex, longestRun } from '@lectio/textguard';
import type { ShingleIndex } from '@lectio/textguard';

import type { Gate, GateContext } from '../core/gate.ts';
import { finding, resultFromFindings } from '../core/result.ts';
import type { GateResultItem } from '../core/result.ts';
import { defineRule } from '../core/rules.ts';
import { indexSourceWords, longestSharedRun, readableText } from './overlap.ts';
import type { SourceWords } from './overlap.ts';
import { englishWordCount, excerptFields, noteFields, preview, quotedSpans, webSources, wordCount } from './text.ts';
import type { NoteField, WebSourceRef } from './text.ts';

export { LIMITATION };

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
    'No note text shares a run of licenceGuard.maxBibleRunWords or more words with a public-domain English Bible (World English Bible, Douay-Rheims).',
    'Rewrite the sentence in your own words and point to the verse by reference instead of reproducing its wording.',
  ),
  commentaryOverlap: defineRule(
    'licence/commentary-overlap',
    'No note text shares a run of more than licenceGuard.maxCommentaryRunWords words with the fetched text of a cited web source.',
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

/** The changed passage files under the content root (deleted files excluded). */
function changedPassages(context: GateContext): string[] {
  const root = context.config.content.root.replace(/^\.\/?/u, '').replace(/\/$/u, '');
  const prefix = root === '' ? '' : `${root}/`;
  return context.changedFiles
    .filter((file) => file.status !== 'deleted')
    .map((file) => file.path)
    .filter((path) => path.startsWith(prefix) && path.slice(prefix.length).split('/').length === 2)
    .filter((path) => contentKindOf(path) === 'passage');
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
  passage: unknown,
  fields: readonly NoteField[],
  fetcher: SourceFetcher,
  cache: Map<string, Promise<SourceOutcome>>,
  limits: LicenceGuardConfig,
): Promise<{ items: GateResultItem[]; checked: number }> {
  const items: GateResultItem[] = [];
  const byUrl = new Map<string, WebSourceRef[]>();
  for (const source of webSources(passage)) {
    const key = `${source.url}\0${source.archivedUrl ?? ''}`;
    byUrl.set(key, [...(byUrl.get(key) ?? []), source]);
    if (!cache.has(key)) cache.set(key, fetchSource(fetcher, source));
  }
  let checked = 0;
  for (const [key, sources] of byUrl) {
    const outcome = await (cache.get(key) as Promise<SourceOutcome>);
    const first = sources[0] as WebSourceRef;
    if ('problem' in outcome) {
      for (const source of sources) {
        items.push(
          finding(LICENCE_RULES.commentaryUnchecked, {
            file,
            pointer: source.pointer,
            severity: 'warning',
            message:
              `source ${source.sourceId} (${source.url}) could not be checked for copied wording: ${outcome.problem}. ` +
              'An unchecked source never passes silently; a reviewer must compare the note with it.',
          }),
        );
      }
      continue;
    }
    checked++;
    const ids = sources.map((source) => source.sourceId).join(', ');
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
  const files = changedPassages(context);
  const meta = { files: files.length, limits: { ...limits }, limitation: LIMITATION };
  if (files.length === 0) return resultFromFindings('licence', [], meta);

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
  for (const file of files) {
    const passage = parse(context.readFile(file));
    if (passage === undefined) continue; // unreadable JSON is the schema gate's finding
    const fields = noteFields(passage);
    items.push(...checkQuotes(file, fields, limits));
    if ('index' in guard) items.push(...checkBible(file, fields, guard.index, limits));
    const commentary = await checkCommentary(file, passage, fields, context.providers.fetcher, cache, limits);
    items.push(...commentary.items);
    sourcesChecked += commentary.checked;
    items.push(...checkExcerpts(file, passage, limits));
  }
  items.push(finding(LICENCE_RULES.pdBibleOverlap, { severity: 'info', message: `Limitation: ${LIMITATION}` }));
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
