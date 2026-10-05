/**
 * Gate `evidence` (Evidence tests): cited excerpts appear in the fetched source; quoted
 * original-language words occur in that verse of the in-repo corpus.
 *
 * For every passage file the PR adds or changes:
 *
 * - `evidence/web-excerpt-found`: each web source's page is fetched through the `SourceFetcher`
 *   provider (falling back to `archivedUrl`) and its excerpt must occur in the page text as whole
 *   words, after HTML-entity decoding and with whitespace, quotes, dashes and case normalised.
 *   Ellipsis-joined pieces must appear in order, close together. An excerpt found on the page but
 *   with fewer than three words in a piece is too short to verify and is flagged. A page that
 *   cannot be fetched (network error, HTTP error, a PDF or other unsupported body, no text) or a
 *   web source without an excerpt is flagged for review, not failed.
 * - `evidence/scripture-source-real`: each scripture source's `ref` parses to real verses, and an
 *   excerpt in Greek, Hebrew, Aramaic or Latin occurs in those verses of the corpus edition. An
 *   excerpt written in Greek or Hebrew script is checked whatever `excerptLang` says, and a missing
 *   or non-corpus tag on it is an error; any other excerpt the corpus cannot check is flagged.
 * - `evidence/original-word-in-verse`: every word of each translation note's `original.text`
 *   occurs (surface form or lemma) at the note's verse in the edition for its language, through
 *   the versification mapping (Greek Esther's lettered chapters read `EST/A.json`…`F.json`).
 * - `evidence/print-source-flag`: claims resting on print sources cannot be checked automatically
 *   and are flagged for review.
 *
 * Swete's Septuagint (grc-lxx) draws some verse boundaries a few words away from Rahlfs's
 * numbering (Sir 3:26, 2 Mc 4:20): text found only by adding the verse before or after is a
 * warning that names that verse, not a failure.
 *
 * Findings about a source are reported once per claim that cites it, so the PR comment names the
 * claim and the source. Files that fail the passage schema are left to the schema gate.
 *
 * The gate uses whatever fetcher the providers carry: the fakes (fixtures) in unit tests and
 * ci.yml, the live fetcher (L-030) only where the content-gates workflow (L-031) injects it.
 * `meta.fetch` reports which one ran.
 */
import { join } from 'node:path';

import type { SourceFetcher } from '@lectio/providers';
import { chapterLabel, enumerateVerses, fromKey, getBook, isRealVerse, tryParseRef, verseCounts } from '@lectio/refs';
import type { BookCode, VerseId } from '@lectio/refs';
import { validatePassage } from '@lectio/schema/passage';
import type { Passage, PassageSource } from '@lectio/schema/passage';
import type { Token } from '@lectio/corpus';

import type { Gate, GateContext } from '../core/gate.ts';
import { finding, resultFromFindings } from '../core/result.ts';
import type { GateResultItem, Severity } from '../core/result.ts';
import { defineRule } from '../core/rules.ts';
import type { Rule } from '../core/rules.ts';
import {
  isCorpusLanguage,
  languageName,
  lookupVerses,
  openEvidenceCorpus,
  phraseInTokens,
  phrasePieces,
  scriptLanguage,
  wordsNotInTokens,
} from './corpus.ts';
import type { CorpusLanguage, EvidenceCorpus, Neighbour, VerseLookup } from './corpus.ts';
import { MIN_PIECE_WORDS, excerptLongEnough, excerptOccurs, excerptPieces } from './normalise.ts';

export { EDITIONS, editionFor, editionVerse, openEvidenceCorpus } from './corpus.ts';
export type { EvidenceCorpus } from './corpus.ts';
export { decodeEntities, excerptOccurs, normaliseText } from './normalise.ts';

export const EVIDENCE_RULES = {
  webExcerptFound: defineRule(
    'evidence/web-excerpt-found',
    'Every web source’s excerpt appears in the page fetched from its URL (a page that cannot be fetched is flagged for review).',
    'Copy the excerpt word for word from the page at the source URL (or its archivedUrl), or correct the URL. If the page is gone, add an archivedUrl.',
  ),
  scriptureSourceReal: defineRule(
    'evidence/scripture-source-real',
    'Every scripture source cites real verses, and its Greek, Hebrew, Aramaic or Latin excerpt occurs in those verses of the corpus.',
    'Correct the source’s ref to the verse it quotes, or copy the excerpt from that verse of the original text.',
  ),
  originalWordInVerse: defineRule(
    'evidence/original-word-in-verse',
    'Every word a translation note quotes in the original language occurs in that verse of the corpus edition for its language.',
    'Correct the note’s verse, or spell original.text as it stands in that verse (SBLGNT or LXX for Greek, OSHB for Hebrew and Aramaic, the Vulgate for Latin).',
  ),
  printSourceFlag: defineRule(
    'evidence/print-source-flag',
    'A claim resting on a print source cannot be checked automatically, so it is flagged for a reviewer.',
    'A reviewer checks the citation against the book. Where possible, also cite a web or scripture source the gate can check.',
  ),
} as const;

export interface EvidenceGateOptions {
  /** The corpus to check original-language text against; defaults to `<root>/corpus`. */
  readonly corpus?: (root: string) => EvidenceCorpus;
}

interface FileCheck {
  readonly path: string;
  readonly passage: Passage;
  readonly items: GateResultItem[];
  readonly corpus: EvidenceCorpus;
  readonly fetch: (source: PassageSource & { url: string }) => Promise<FetchOutcome>;
}

type FetchOutcome =
  | { readonly ok: true; readonly text: string; readonly note: string }
  | { readonly ok: false; readonly problem: string };

/** The claims citing each source id, in claim order. */
function citingClaims(passage: Passage): Map<string, string[]> {
  const claims = new Map<string, string[]>();
  for (const claim of passage.claims) {
    for (const id of claim.sourceIds) claims.set(id, [...(claims.get(id) ?? []), claim.id]);
  }
  return claims;
}

/** Reports `message` once per claim citing the source (once without a claim when none does). */
function reportSource(
  check: FileCheck,
  rule: Rule,
  index: number,
  field: string,
  severity: Severity,
  message: string,
): void {
  const source = check.passage.sources[index] as PassageSource;
  const claims = citingClaims(check.passage).get(source.id) ?? [];
  const pointer = `/sources/${String(index)}${field === '' ? '' : `/${field}`}`;
  if (claims.length === 0) {
    check.items.push(
      finding(rule, { file: check.path, pointer, severity, message: `source "${source.id}" ${message}` }),
    );
    return;
  }
  for (const claimId of claims) {
    check.items.push(
      finding(rule, {
        file: check.path,
        pointer,
        claimId,
        severity,
        message: `claim ${claimId} cites source "${source.id}", which ${message}`,
      }),
    );
  }
}

function quote(text: string): string {
  return `“${text.length > 80 ? `${text.slice(0, 77)}…` : text}”`;
}

async function checkWebSource(check: FileCheck, source: PassageSource, index: number): Promise<void> {
  const rule = EVIDENCE_RULES.webExcerptFound;
  const url = source.url as string; // the passage schema requires it
  if (source.excerpt === undefined || excerptPieces(source.excerpt).length === 0) {
    reportSource(check, rule, index, '', 'warning', `has no excerpt to check against ${url}; a reviewer must check it`);
    return;
  }
  const outcome = await check.fetch({ ...source, url });
  if (!outcome.ok) {
    reportSource(check, rule, index, 'url', 'warning', `could not be checked: ${outcome.problem}`);
    return;
  }
  if (!excerptOccurs(source.excerpt, outcome.text)) {
    reportSource(
      check,
      rule,
      index,
      'excerpt',
      'error',
      `quotes ${quote(source.excerpt)}, which is not on ${outcome.note}`,
    );
  } else if (!excerptLongEnough(source.excerpt)) {
    reportSource(
      check,
      rule,
      index,
      'excerpt',
      'warning',
      `quotes ${quote(source.excerpt)}, which is too short to verify: quote at least ${String(MIN_PIECE_WORDS)} words (in each piece between ellipses)`,
    );
  }
}

type FoundLookup = Extract<VerseLookup, { kind: 'ok' }>;

function verseLabel({ book, c, v }: Neighbour['verse']): string {
  return `${getBook(book).abbrev} ${chapterLabel(book, c)}:${String(v)}`;
}

/**
 * For editions with loose verse boundaries (grc-lxx): the neighbouring verse(s) that make `test`
 * pass when added to the cited ones, named for the message; undefined when none does.
 */
function nearbyMatch(lookup: FoundLookup, test: (tokens: readonly Token[]) => boolean): string | undefined {
  const { before, after } = lookup;
  const tries: { readonly b?: Neighbour; readonly a?: Neighbour }[] = [];
  if (after !== undefined) tries.push({ a: after });
  if (before !== undefined) tries.push({ b: before });
  if (before !== undefined && after !== undefined) tries.push({ b: before, a: after });
  for (const { b, a } of tries) {
    const tokens = [...(b?.tokens ?? []), ...lookup.tokens, ...(a?.tokens ?? [])];
    if (test(tokens)) return [b, a].flatMap((n) => (n === undefined ? [] : [verseLabel(n.verse)])).join(' and ');
  }
  return undefined;
}

/** The canonical verses a scripture ref covers, or why it does not name real verses. */
function scriptureVerses(ref: string): { book: BookCode; verses: VerseId[] } | { problem: string } {
  const parsed = tryParseRef(ref);
  if (!parsed.ok) return { problem: `has a ref “${ref}” that does not parse (${parsed.error.message})` };
  if (!isRealVerse(parsed.value)) return { problem: `cites “${ref}”, which is not a real verse` };
  return { book: parsed.value.book, verses: enumerateVerses(parsed.value, verseCounts()) };
}

async function checkScriptureSource(check: FileCheck, source: PassageSource, index: number): Promise<void> {
  const rule = EVIDENCE_RULES.scriptureSourceReal;
  const ref = source.ref as string; // the passage schema requires it
  const target = scriptureVerses(ref);
  if ('problem' in target) {
    reportSource(check, rule, index, 'ref', 'error', target.problem);
    return;
  }
  const { excerpt, excerptLang: tag } = source;
  if (excerpt === undefined) return;
  const script = scriptLanguage(excerpt);
  let lang: CorpusLanguage;
  if (isCorpusLanguage(tag)) {
    lang = tag;
  } else if (script !== undefined) {
    // Greek or Hebrew script is checked whatever the tag says; a wrong or missing tag is itself an error.
    const tagged = tag === undefined ? 'has no excerptLang' : `is tagged "${tag}"`;
    reportSource(
      check,
      rule,
      index,
      'excerptLang',
      'error',
      `quotes ${languageName(script)} script, but its excerpt ${tagged}; tag it "${script}"${script === 'hbo' ? ' (or "arc" for Aramaic)' : ''}`,
    );
    lang = script;
  } else {
    const tagged = tag === undefined ? '' : ` (tagged "${tag}")`;
    reportSource(
      check,
      rule,
      index,
      'excerpt',
      'warning',
      `has an excerpt${tagged} that is not Greek, Hebrew, Aramaic or Latin, so it cannot be checked against the corpus`,
    );
    return;
  }
  const lookup = await lookupVerses(check.corpus, lang, target.book, target.verses);
  if (lookup.kind === 'no-original') {
    reportSource(
      check,
      rule,
      index,
      'excerptLang',
      'error',
      `quotes ${languageName(lang)} for ${ref}, but ${lookup.reason}`,
    );
    return;
  }
  if (lookup.kind === 'unavailable') {
    reportSource(check, rule, index, 'excerpt', 'warning', `could not be checked: ${lookup.reason}`);
    return;
  }
  if (lookup.missing.length === target.verses.length) {
    reportSource(check, rule, index, 'ref', 'error', `cites ${ref}, which is not in ${lookup.edition}`);
    return;
  }
  const occurs = (tokens: readonly Token[]): boolean => phraseInTokens(lookup.language, tokens, excerpt);
  if (occurs(lookup.tokens)) return;
  const near = nearbyMatch(lookup, occurs);
  if (near !== undefined) {
    reportSource(
      check,
      rule,
      index,
      'excerpt',
      'warning',
      `quotes ${quote(excerpt)}, which ${lookup.edition} has only when ${near} ${near.includes(' and ') ? 'are' : 'is'} included: its verse boundaries can differ from the cited numbering, so a reviewer must check the ref`,
    );
    return;
  }
  reportSource(
    check,
    rule,
    index,
    'excerpt',
    'error',
    `quotes ${quote(excerpt)}, which does not occur in ${ref} (${lookup.edition})`,
  );
}

function checkPrintSource(check: FileCheck, source: PassageSource, index: number): void {
  reportSource(
    check,
    EVIDENCE_RULES.printSourceFlag,
    index,
    '',
    'warning',
    `is a print source (${source.citation}) and cannot be checked automatically`,
  );
}

const MARKER = /\[(c[1-9][0-9]*)\]/gu;

async function checkNote(check: FileCheck, index: number): Promise<void> {
  const rule = EVIDENCE_RULES.originalWordInVerse;
  const note = check.passage.translationNotes[index] as Passage['translationNotes'][number];
  const claims = [...new Set([...note.body.matchAll(MARKER)].map((match) => match[1] as string))];
  const book = fromKey(check.passage.key).book;
  const [c, v] = note.verse.split(':').map(Number) as [number, number];
  const verse: VerseId = { book, c, v };
  const where = `${book} ${note.verse}`;
  const report = (field: string, severity: Severity, message: string): void => {
    const about = `translation note "${note.id}" (${claims.length === 1 ? 'claim' : 'claims'} ${claims.join(', ')})`;
    check.items.push(
      finding(rule, {
        file: check.path,
        pointer: `/translationNotes/${String(index)}/${field}`,
        claimId: claims[0] as string, // a note body always carries a claim marker (schema)
        severity,
        message: `${about} ${message}`,
      }),
    );
  };
  if (!isRealVerse(verse)) {
    report('verse', 'error', `is on ${where}, which is not a real verse`);
    return;
  }
  const lang = note.original.lang as CorpusLanguage;
  if (phrasePieces(lang, note.original.text).length === 0) {
    report('original/text', 'error', `quotes ${quote(note.original.text)}, which has no words to check`);
    return;
  }
  const lookup = await lookupVerses(check.corpus, lang, book, [verse]);
  if (lookup.kind === 'no-original') {
    report('original/lang', 'error', `quotes ${languageName(lang)}, but ${lookup.reason}`);
    return;
  }
  if (lookup.kind === 'unavailable') {
    report('original/text', 'warning', `could not be checked: ${lookup.reason}`);
    return;
  }
  if (lookup.missing.length > 0) {
    report('verse', 'error', `is on ${where}, which is not in ${lookup.edition}`);
    return;
  }
  const missing = wordsNotInTokens(lookup.language, lookup.tokens, note.original.text);
  if (missing.length === 0) return;
  const words = missing.join(' ');
  const near = nearbyMatch(lookup, (tokens) => wordsNotInTokens(lookup.language, tokens, words).length === 0);
  if (near !== undefined) {
    report(
      'original/text',
      'warning',
      `quotes ${quote(note.original.text)}; ${missing.map((word) => `“${word}”`).join(', ')} ${lookup.edition} has only in ${near}: its verse boundaries can differ from the cited numbering, so a reviewer must check the verse`,
    );
    return;
  }
  report(
    'original/text',
    'error',
    `quotes ${quote(note.original.text)}, but ${missing.map((word) => `“${word}”`).join(', ')} ${missing.length === 1 ? 'does' : 'do'} not occur in ${where} (${lookup.edition})`,
  );
}

async function checkFile(check: FileCheck): Promise<void> {
  for (const [index, source] of check.passage.sources.entries()) {
    if (source.type === 'web') await checkWebSource(check, source, index);
    else if (source.type === 'scripture') await checkScriptureSource(check, source, index);
    else checkPrintSource(check, source, index);
  }
  for (const index of check.passage.translationNotes.keys()) await checkNote(check, index);
}

/** One fetch per URL (and archive fallback) per run, so sources sharing a page fetch it once. */
function cachedFetcher(fetcher: SourceFetcher): FileCheck['fetch'] {
  const cache = new Map<string, Promise<FetchOutcome>>();
  return (source) => {
    const key = `${source.url}\0${source.archivedUrl ?? ''}`;
    let outcome = cache.get(key);
    if (outcome === undefined) {
      outcome = fetchOutcome(fetcher, source.url, source.archivedUrl);
      cache.set(key, outcome);
    }
    return outcome;
  };
}

async function fetchOutcome(
  fetcher: SourceFetcher,
  url: string,
  archivedUrl: string | undefined,
): Promise<FetchOutcome> {
  try {
    const page = await fetcher.fetch(url, archivedUrl === undefined ? {} : { archivedUrl });
    const unsupported = (page as { unsupported?: unknown }).unsupported;
    if (page.status >= 400) return { ok: false, problem: `fetching ${url} returned HTTP ${String(page.status)}` };
    if (unsupported !== undefined && unsupported !== false) {
      return {
        ok: false,
        problem: `${url} is ${typeof unsupported === 'string' ? `a ${unsupported}` : 'an unsupported'} document (${page.contentType}) the gate cannot read`,
      };
    }
    if (page.text.trim() === '') return { ok: false, problem: `${url} returned no text` };
    const note = page.fromArchive === true ? `the archived copy ${archivedUrl as string}` : url;
    return { ok: true, text: page.text, note };
  } catch (error) {
    return { ok: false, problem: `fetching ${url} failed (${error instanceof Error ? error.message : String(error)})` };
  }
}

/** Repository-relative passage files the PR adds or changes, under the configured content root. */
function changedPassages(context: GateContext): string[] {
  const root = context.config.content.root.replace(/^\.\/?/u, '').replace(/\/$/u, '');
  const dir = root === '' ? 'passages/' : `${root}/passages/`;
  return context.changedFiles
    .filter(
      (file) =>
        file.status !== 'deleted' && file.path.startsWith(dir) && /^[^/]+\.json$/u.test(file.path.slice(dir.length)),
    )
    .map((file) => file.path);
}

function readPassage(context: GateContext, path: string): Passage | undefined {
  const text = context.readFile(path);
  if (text === null) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  return validatePassage(value) ? value : undefined;
}

/** The evidence gate over an injectable corpus (tests); {@link evidenceGate} reads `<root>/corpus`. */
export function createEvidenceGate(options: EvidenceGateOptions = {}): Gate {
  const openCorpusAt = options.corpus ?? ((root: string) => openEvidenceCorpus(join(root, 'corpus')));
  return {
    id: 'evidence',
    title: 'Evidence tests',
    rules: Object.values(EVIDENCE_RULES),
    async run(context) {
      const corpus = openCorpusAt(context.root);
      const fetch = cachedFetcher(context.providers.fetcher);
      const items: GateResultItem[] = [];
      const checked: string[] = [];
      const skipped: string[] = [];
      for (const path of changedPassages(context)) {
        const passage = readPassage(context, path);
        if (passage === undefined) {
          skipped.push(path);
          continue;
        }
        checked.push(path);
        await checkFile({ path, passage, items, corpus, fetch });
      }
      return resultFromFindings('evidence', items, {
        fetch: context.providers.fakes.has('fetcher') ? 'fixtures' : 'live',
        files: checked,
        ...(skipped.length === 0 ? {} : { invalidFiles: skipped }),
      });
    },
  };
}

export const evidenceGate: Gate = createEvidenceGate();
