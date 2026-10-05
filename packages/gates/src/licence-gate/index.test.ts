import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_CONFIG } from '@lectio/config';
import type { LectioConfig, LicenceGuardConfig } from '@lectio/config';
import { MemorySourceFetcher, ProviderError, createProviders } from '@lectio/providers';
import type { FakeSourcePage, SourceFetcher } from '@lectio/providers';
import { LIMITATION, buildIndex, loadIndex } from '@lectio/textguard';
import type { ShingleIndex } from '@lectio/textguard';

import { createContext } from '../core/gate.ts';
import type { GateContext } from '../core/gate.ts';
import type { ChangedFile } from '../core/git.ts';
import type { GateResult, GateResultItem } from '../core/result.ts';
import { runGates } from '../core/runner.ts';
import {
  ARCHIVE_URL,
  OTHER_URL,
  PSEUDO_COMMENTARY,
  PSEUDO_SCRIPTURE,
  SOURCE_URL,
  commentaryRun,
  passage,
  scripture,
  webSource,
  words,
} from './fixtures/cases.ts';
import { LICENCE_RULES, createLicenceGate, fileGuardIndexLoader, guardIndexPath, licenceGate } from './index.ts';
import type { GuardIndexLoader } from './index.ts';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const SEED = 'passages/MT.20.1-16.json';
const FILE = 'passages/MT.20.1-16.json';

const pseudoIndex = loadIndex(buildIndex([PSEUDO_SCRIPTURE], { shingleSize: 8 }));
const pseudoLoader: GuardIndexLoader = () => pseudoIndex;

interface ContextOptions {
  readonly files?: Readonly<Record<string, string>>;
  readonly changed?: readonly ChangedFile[];
  readonly limits?: Partial<LicenceGuardConfig>;
  readonly contentRoot?: string;
  readonly fetcher?: SourceFetcher;
  readonly root?: string;
}

function context(options: ContextOptions = {}): GateContext {
  const files = options.files ?? {};
  const changed = options.changed ?? Object.keys(files).map((path) => ({ path, status: 'added' as const }));
  const config: LectioConfig = {
    ...DEFAULT_CONFIG,
    content: { ...DEFAULT_CONFIG.content, root: options.contentRoot ?? DEFAULT_CONFIG.content.root },
    licenceGuard: { ...DEFAULT_CONFIG.licenceGuard, ...options.limits },
  };
  const root = options.root ?? '/repo';
  return createContext({
    root,
    base: 'origin/main',
    head: 'HEAD',
    config,
    providers: createProviders(config, {}, options.fetcher === undefined ? {} : { fetcher: options.fetcher }),
    git: { changedFiles: () => [...changed], show: () => null },
    readText: (path) => files[path.slice(root.length + 1)] ?? null,
  });
}

async function check(
  body: Record<string, unknown>,
  options: Omit<ContextOptions, 'files'> & { readonly loader?: GuardIndexLoader } = {},
): Promise<GateResult> {
  const gate = createLicenceGate({ loadGuardIndex: options.loader ?? pseudoLoader });
  return gate.run(context({ ...options, files: { [FILE]: JSON.stringify(body) } }));
}

const findings = (result: GateResult, rule: { id: string }): GateResultItem[] =>
  result.items.filter((item) => item.ruleId === rule.id && item.severity !== 'info');

const pages = (entries: Record<string, string | FakeSourcePage>): MemorySourceFetcher =>
  new MemorySourceFetcher(
    Object.fromEntries(
      Object.entries(entries).map(([url, page]) => [url, typeof page === 'string' ? { text: page } : page]),
    ),
  );

describe('the licence gate', () => {
  it('keeps the registry export and declares every rule under its id', () => {
    expect(licenceGate.id).toBe('licence');
    expect(licenceGate.title).toBe('Licence guard');
    expect(licenceGate.rules.map((rule) => rule.id)).toEqual([
      'licence/quoted-english-run',
      'licence/pd-bible-overlap',
      'licence/commentary-overlap',
      'licence/commentary-unchecked',
      'licence/excerpt-length',
      'licence/guard-index',
    ]);
  });

  it('passes a clean passage and repeats the L-013 limitation in its output', async () => {
    const result = await check(passage());
    expect(result.status).toBe('pass');
    expect(result.items).toEqual([
      {
        ruleId: LICENCE_RULES.pdBibleOverlap.id,
        severity: 'info',
        pointer: '',
        message: `Limitation: ${LIMITATION}`,
      },
    ]);
    expect(result.meta).toMatchObject({ files: 1, limitation: LIMITATION, limits: DEFAULT_CONFIG.licenceGuard });
  });

  it('passes without loading the index when no passage changed', async () => {
    const loader = vi.fn(pseudoLoader);
    const gate = createLicenceGate({ loadGuardIndex: loader });
    const result = await gate.run(
      context({
        files: { 'calendar/2026.json': '{}', 'docs/notes.md': '"' + words(30) + '"', 'passages/sub/x.json': '{}' },
        changed: [
          { path: 'calendar/2026.json', status: 'added' },
          { path: 'docs/notes.md', status: 'modified' },
          { path: 'passages/sub/x.json', status: 'added' },
          { path: 'passages/OLD.json', status: 'deleted' },
        ],
      }),
    );
    expect(result).toMatchObject({ gate: 'licence', status: 'pass', items: [], meta: { files: 0 } });
    expect(loader).not.toHaveBeenCalled();
  });

  it('skips passage files that are missing or not JSON (the schema gate reports those)', async () => {
    const gate = createLicenceGate({ loadGuardIndex: pseudoLoader });
    const result = await gate.run(
      context({
        files: { 'passages/BAD.json': '{ nope' },
        changed: [
          { path: 'passages/BAD.json', status: 'added' },
          { path: 'passages/GONE.json', status: 'modified' },
        ],
      }),
    );
    expect(result.status).toBe('pass');
    expect(result.meta).toMatchObject({ files: 2 });
  });

  it('reads passages under the configured content root', async () => {
    const gate = createLicenceGate({ loadGuardIndex: pseudoLoader });
    const long = passage({ summary: `“${words(11)}”` });
    const ctx = context({
      contentRoot: './content/',
      files: { 'content/passages/A.json': JSON.stringify(long), 'passages/B.json': JSON.stringify(long) },
    });
    const result = await gate.run(ctx);
    expect(result.items.filter((item) => item.severity === 'error').map((item) => item.file)).toEqual([
      'content/passages/A.json',
    ]);
  });

  it('validates through the runner with no runner findings', async () => {
    const body = passage({ summary: `“${words(11)}”`, sources: [webSource('s1', SOURCE_URL, { excerpt: words(26) })] });
    const gate = createLicenceGate({ loadGuardIndex: pseudoLoader });
    const report = await runGates([gate], context({ files: { [FILE]: JSON.stringify(body) } }));
    const result = report.results[0] as GateResult;
    expect(result.status).toBe('fail');
    expect(result.items.some((item) => item.ruleId.startsWith('runner/'))).toBe(false);
  });
});

describe('licence/quoted-english-run', () => {
  it('passes a quotation of exactly maxQuotedWords English words', async () => {
    expect(
      findings(await check(passage({ summary: `He asks “${words(10)}”.` })), LICENCE_RULES.quotedEnglishRun),
    ).toEqual([]);
  });

  it('fails one word over the limit, pointing at the field and claim', async () => {
    const result = await check(passage({ claims: [{ id: 'c1', text: `It says ‘${words(11)}’ here.` }] }));
    expect(result.status).toBe('fail');
    expect(findings(result, LICENCE_RULES.quotedEnglishRun)).toEqual([
      {
        ruleId: 'licence/quoted-english-run',
        severity: 'error',
        file: FILE,
        pointer: '/claims/0/text',
        claimId: 'c1',
        message:
          'quotes 11 words of English (limit 10): “w1 w2 w3 w4 w5 w6 w7 w8…”. Lectio never reproduces a Bible ' +
          'translation or a commentary: it links out for the text and writes its own notes.',
      },
    ]);
  });

  it('does not count original-language words or verse numbers', async () => {
    const greek = 'ἄφες τὸ σὸν καὶ ὕπαγε θέλω δὲ τούτῳ τῷ ἐσχάτῳ δοῦναι ὡς καὶ σοί';
    const numbered = `“16 ${words(5)} 17 ${words(5, 'v')}”`;
    const result = await check(passage({ paragraphs: [`Greek “${greek}” reads so. [c1]`, `${numbered} [c1]`] }));
    expect(findings(result, LICENCE_RULES.quotedEnglishRun)).toEqual([]);
  });

  it('says when a quotation is never closed', async () => {
    const result = await check(passage({ noteBody: `He said “${words(12)} [c1]` }));
    expect(findings(result, LICENCE_RULES.quotedEnglishRun)[0]?.message).toContain(
      'quotes 12 words of English (limit 10) (the quotation is never closed, so it runs to the end of the text)',
    );
  });

  it('reads the limit from config', async () => {
    const body = passage({ gloss: `“${words(4)}”` });
    expect(findings(await check(body, { limits: { maxQuotedWords: 4 } }), LICENCE_RULES.quotedEnglishRun)).toEqual([]);
    expect(findings(await check(body, { limits: { maxQuotedWords: 3 } }), LICENCE_RULES.quotedEnglishRun)).toHaveLength(
      1,
    );
  });
});

describe('licence/pd-bible-overlap', () => {
  it('passes a run one word short of maxBibleRunWords', async () => {
    const result = await check(passage({ paragraphs: [`As it is written, ${scripture(11)}. [c1]`] }));
    expect(findings(result, LICENCE_RULES.pdBibleOverlap)).toEqual([]);
  });

  it('fails a run of exactly maxBibleRunWords, with the matched words', async () => {
    const result = await check(passage({ paragraphs: [`As it is written, ${scripture(12)}. [c1]`] }));
    expect(findings(result, LICENCE_RULES.pdBibleOverlap)).toEqual([
      {
        ruleId: 'licence/pd-bible-overlap',
        severity: 'error',
        file: FILE,
        pointer: '/context/paragraphs/0',
        message:
          '12 words match a public-domain English Bible word for word (limit: fewer than 12): ' +
          '“Vintners gathered beside amber terraces while patient stewards…”. Lectio never reproduces a Bible ' +
          'translation or a commentary: it links out for the text and writes its own notes.',
      },
    ]);
  });

  it('reads the limit from config', async () => {
    const body = passage({ summary: scripture(10) });
    expect(findings(await check(body, { limits: { maxBibleRunWords: 11 } }), LICENCE_RULES.pdBibleOverlap)).toEqual([]);
    expect(
      findings(await check(body, { limits: { maxBibleRunWords: 10 } }), LICENCE_RULES.pdBibleOverlap),
    ).toHaveLength(1);
  });

  it('fails the run when the index cannot be loaded, and still runs the other rules', async () => {
    const result = await check(passage({ summary: `“${words(11)}”` }), {
      loader: () => {
        throw new Error('ENOENT: no such file');
      },
    });
    expect(result.status).toBe('fail');
    expect(findings(result, LICENCE_RULES.guardIndex)).toEqual([
      {
        ruleId: 'licence/guard-index',
        severity: 'error',
        pointer: '',
        message:
          'cannot load corpus/guard/en-pd-8.bin: ENOENT: no such file. Without the index no note can be checked ' +
          'against public-domain Bible wording.',
      },
    ]);
    expect(findings(result, LICENCE_RULES.quotedEnglishRun)).toHaveLength(1);
  });

  it('reports maxBibleRunWords below the shingle size as a config error', async () => {
    const result = await check(passage(), { limits: { maxBibleRunWords: 7 } });
    expect(result.status).toBe('fail');
    expect(findings(result, LICENCE_RULES.guardIndex).map((item) => item.message)).toEqual([
      'config error: licenceGuard.maxBibleRunWords (7) is below licenceGuard.shingleSize (8). The index cannot see a ' +
        'run shorter than one shingle, so the real limit would silently be the shingle size. Raise maxBibleRunWords ' +
        'or rebuild the index with a smaller shingle size.',
    ]);
    expect(findings(await check(passage(), { limits: { maxBibleRunWords: 8 } }), LICENCE_RULES.guardIndex)).toEqual([]);
  });

  it('refuses an index whose shingle size or normaliser version does not match', async () => {
    const sized = await check(passage(), { limits: { shingleSize: 6 } });
    expect(findings(sized, LICENCE_RULES.guardIndex)[0]?.message).toMatch(
      /^the index uses 8-word shingles but licenceGuard.shingleSize is 6\./u,
    );
    const old: ShingleIndex = { ...pseudoIndex, normaliserVersion: 1, has: (key) => pseudoIndex.has(key) };
    const versioned = await check(passage(), { loader: () => old });
    expect(findings(versioned, LICENCE_RULES.guardIndex)[0]?.message).toMatch(
      /^the index was built with normaliser version 1, textguard is at 2\./u,
    );
    const thrown = await check(passage(), {
      loader: () => {
        throw 'odd';
      },
    });
    expect(findings(thrown, LICENCE_RULES.guardIndex)[0]?.message).toMatch(/^cannot load .*: odd\./u);
  });

  it('loads the committed index from the PR head once per path', async () => {
    expect(guardIndexPath(8)).toBe('corpus/guard/en-pd-8.bin');
    const ctx = context({ root: REPO_ROOT });
    const index = fileGuardIndexLoader(ctx);
    expect(index).toMatchObject({ shingleSize: 8, normaliserVersion: 2 });
    expect(index.size).toBeGreaterThan(1_000_000);
    expect(fileGuardIndexLoader(ctx)).toBe(index);
  });
});

describe('licence/commentary-overlap', () => {
  const cited = (paragraph: string, extra: Record<string, unknown> = {}): Record<string, unknown> =>
    passage({ paragraphs: [paragraph], sources: [webSource('s1', SOURCE_URL, extra)] });

  it('passes a shared run of exactly maxCommentaryRunWords', async () => {
    const result = await check(cited(`${commentaryRun(12)}. [c1]`), {
      fetcher: pages({ [SOURCE_URL]: PSEUDO_COMMENTARY }),
    });
    expect(result.status).toBe('pass');
    expect(result.meta).toMatchObject({ sourcesFetched: 1, sourcesChecked: 1 });
  });

  it('fails one word over the limit, naming the source', async () => {
    const result = await check(cited(`${commentaryRun(13)}. [c1]`), {
      fetcher: pages({ [SOURCE_URL]: PSEUDO_COMMENTARY }),
    });
    expect(findings(result, LICENCE_RULES.commentaryOverlap)).toEqual([
      {
        ruleId: 'licence/commentary-overlap',
        severity: 'error',
        file: FILE,
        pointer: '/context/paragraphs/0',
        message:
          `13 words are copied from ${SOURCE_URL} (cited as s1; limit 12): “In this parable the householder stands ` +
          'for a…”. Lectio never reproduces a Bible translation or a commentary: it links out for the text and ' +
          'writes its own notes.',
      },
    ]);
  });

  it('does not reduce already reduced text/html text again, so a run between < and > is still found', async () => {
    const text = `Read it this way: if n < 3 then ${commentaryRun(13)} while m > 2 holds.`;
    const fetcher = pages({ [SOURCE_URL]: { text, contentType: 'text/html; charset=utf-8' } });
    const result = await check(cited(`${commentaryRun(13)}. [c1]`), { fetcher });
    expect(findings(result, LICENCE_RULES.commentaryOverlap)[0]?.message).toMatch(/^13 words are copied/u);
  });

  it('checks HTML pages after reducing them to text', async () => {
    const html = `<html><body><p>${PSEUDO_COMMENTARY.replace('householder', '<em>householder</em>')}</p></body></html>`;
    const fetcher = pages({ [SOURCE_URL]: { text: html, contentType: 'text/html' } });
    const result = await check(cited(`${commentaryRun(20)}. [c1]`), { fetcher });
    expect(findings(result, LICENCE_RULES.commentaryOverlap)[0]?.message).toMatch(/^20 words are copied/u);
  });

  it('fetches a URL once for every source and passage that cites it', async () => {
    const fetcher = pages({ [SOURCE_URL]: PSEUDO_COMMENTARY });
    const body = passage({
      sources: [webSource('a', SOURCE_URL), webSource('b', SOURCE_URL), webSource('c', OTHER_URL)],
    });
    const gate = createLicenceGate({ loadGuardIndex: pseudoLoader });
    const result = await gate.run(
      context({ fetcher, files: { 'passages/A.json': JSON.stringify(body), 'passages/B.json': JSON.stringify(body) } }),
    );
    expect(fetcher.fetched).toEqual([SOURCE_URL, OTHER_URL]);
    expect(result.meta).toMatchObject({ sourcesFetched: 2, sourcesChecked: 2 });
    expect(findings(result, LICENCE_RULES.commentaryUnchecked).map((item) => [item.file, item.pointer])).toEqual([
      ['passages/A.json', '/sources/2'],
      ['passages/B.json', '/sources/2'],
    ]);
  });

  it('checks the archived copy when the page is gone, and says so', async () => {
    const fetcher = pages({ 'https://gone.example/page': { status: 410 }, [ARCHIVE_URL]: PSEUDO_COMMENTARY });
    const body = cited(`${commentaryRun(14)}. [c1]`, { url: 'https://gone.example/page', archivedUrl: ARCHIVE_URL });
    const result = await check(body, { fetcher });
    expect(findings(result, LICENCE_RULES.commentaryOverlap)[0]?.message).toMatch(
      /^14 words are copied from https:\/\/gone\.example\/page \(archived copy\) \(cited as s1; limit 12\)/u,
    );
  });

  it('reads the limit from config', async () => {
    const fetcher = pages({ [SOURCE_URL]: PSEUDO_COMMENTARY });
    const body = cited(`${commentaryRun(6)}. [c1]`);
    const at = await check(body, { fetcher, limits: { maxCommentaryRunWords: 6 } });
    expect(findings(at, LICENCE_RULES.commentaryOverlap)).toEqual([]);
    const over = await check(body, { fetcher, limits: { maxCommentaryRunWords: 5 } });
    expect(findings(over, LICENCE_RULES.commentaryOverlap)).toHaveLength(1);
  });
});

describe('licence/commentary-unchecked', () => {
  const body = passage({ sources: [webSource('s1', SOURCE_URL)] });

  it('flags a source whose fetch fails instead of passing it', async () => {
    const fetcher: SourceFetcher = {
      fetch: () => Promise.reject(new ProviderError('timeout', 'request timed out after 30s')),
    };
    const result = await check(body, { fetcher });
    expect(result.status).toBe('flag');
    expect(findings(result, LICENCE_RULES.commentaryUnchecked)).toEqual([
      {
        ruleId: 'licence/commentary-unchecked',
        severity: 'warning',
        file: FILE,
        pointer: '/sources/0',
        message:
          `source s1 (${SOURCE_URL}) could not be checked for copied wording: fetching or reading the page failed: request timed out after ` +
          '30s. An unchecked source never passes silently; a reviewer must compare the note with it.',
      },
    ]);
    expect(result.meta).toMatchObject({ sourcesFetched: 1, sourcesChecked: 0 });
  });

  it('flags HTTP errors, unreadable content and empty pages', async () => {
    const reasons = async (page: FakeSourcePage | undefined): Promise<string | undefined> => {
      const fetcher = pages(page === undefined ? {} : { [SOURCE_URL]: page });
      return findings(await check(body, { fetcher }), LICENCE_RULES.commentaryUnchecked)[0]?.message;
    };
    expect(await reasons(undefined)).toContain('could not be checked for copied wording: HTTP 404.');
    expect(await reasons({ status: 503, text: 'busy' })).toContain(': HTTP 503.');
    expect(await reasons({ contentType: 'application/pdf', text: '%PDF' })).toContain(
      ': cannot read content type "application/pdf".',
    );
    expect(await reasons({ text: '   ' })).toContain(': the page has no text.');
  });

  it('describes odd failures too', async () => {
    const reject = (value: unknown): SourceFetcher => ({ fetch: () => Promise.reject(value as Error) });
    const message = async (value: unknown): Promise<string | undefined> =>
      findings(await check(body, { fetcher: reject(value) }), LICENCE_RULES.commentaryUnchecked)[0]?.message;
    expect(await message(new Error(''))).toContain('fetching or reading the page failed: (no message).');
    expect(await message('socket\n hang up')).toContain('fetching or reading the page failed: socket hang up.');
  });

  it('flags a page that breaks while being read, without crashing or leaving a rejection behind', async () => {
    let release: () => void = () => undefined;
    const slow = new Promise<void>((resolve) => {
      release = resolve;
    });
    const broken = {
      status: 200,
      contentType: 'text/plain',
      retrievedAt: '2026-10-05T00:00:00.000Z',
      get text(): string {
        throw new RangeError('Invalid code point 99999999');
      },
    };
    const fetcher: SourceFetcher = {
      fetch: async (url) => {
        if (url === SOURCE_URL) {
          await slow;
          return { status: 200, text: PSEUDO_COMMENTARY, contentType: 'text/plain', retrievedAt: broken.retrievedAt };
        }
        return broken;
      },
    };
    const two = passage({ sources: [webSource('slow', SOURCE_URL), webSource('bad', OTHER_URL)] });
    const pending = check(two, { fetcher });
    await new Promise((resolve) => setTimeout(resolve, 10));
    release();
    const result = await pending;
    expect(result.status).toBe('flag');
    expect(findings(result, LICENCE_RULES.commentaryUnchecked).map((item) => item.message)).toEqual([
      `source bad (${OTHER_URL}) could not be checked for copied wording: fetching or reading the page failed: ` +
        'Invalid code point 99999999. An unchecked source never passes silently; a reviewer must compare the note with it.',
    ]);
    expect(result.meta).toMatchObject({ sourcesFetched: 2, sourcesChecked: 1 });
  });

  it('checks a page with an out-of-range numeric entity', async () => {
    const html = `<!doctype html><p>&#99999999; ${PSEUDO_COMMENTARY} &#x110000;</p>`;
    const fetcher = pages({ [SOURCE_URL]: { text: html, contentType: 'text/html' } });
    const result = await check(
      passage({ paragraphs: [`${commentaryRun(13)}. [c1]`], sources: [webSource('s1', SOURCE_URL)] }),
      {
        fetcher,
      },
    );
    expect(findings(result, LICENCE_RULES.commentaryUnchecked)).toEqual([]);
    expect(findings(result, LICENCE_RULES.commentaryOverlap)).toHaveLength(1);
  });
});

describe('licence/excerpt-length', () => {
  const withExcerpt = (excerpt: string): Record<string, unknown> =>
    passage({ sources: [{ id: 's1', type: 'print', citation: 'A commentary', excerpt }] });

  it('passes an excerpt of exactly maxExcerptWords', async () => {
    expect(findings(await check(withExcerpt(words(25))), LICENCE_RULES.excerptLength)).toEqual([]);
  });

  it('fails one word over the limit', async () => {
    expect(findings(await check(withExcerpt(words(26))), LICENCE_RULES.excerptLength)).toEqual([
      {
        ruleId: 'licence/excerpt-length',
        severity: 'error',
        file: FILE,
        pointer: '/sources/0/excerpt',
        message:
          'the excerpt of source s1 is 26 words long (limit 25). An excerpt only shows where the claim comes from; ' +
          'a longer one starts to reproduce the source.',
      },
    ]);
  });

  it('counts a single word in the singular', async () => {
    const [item] = findings(
      await check(withExcerpt('one'), { limits: { maxExcerptWords: 0 } }),
      LICENCE_RULES.excerptLength,
    );
    expect(item?.message).toMatch(/^the excerpt of source s1 is 1 word long \(limit 0\)\./u);
  });

  it('reads the limit from config', async () => {
    expect(
      findings(await check(withExcerpt(words(5)), { limits: { maxExcerptWords: 5 } }), LICENCE_RULES.excerptLength),
    ).toEqual([]);
    expect(
      findings(await check(withExcerpt(words(6)), { limits: { maxExcerptWords: 5 } }), LICENCE_RULES.excerptLength),
    ).toHaveLength(1);
  });
});

describe('the real seed passage (passages/MT.20.1-16.json)', () => {
  const seed = readFileSync(join(REPO_ROOT, SEED), 'utf8');
  const urls = [
    ...new Set(
      (JSON.parse(seed) as { sources: { type: string; url?: string }[] }).sources
        .filter((source) => source.type === 'web')
        .map((source) => source.url as string),
    ),
  ];

  const run = (fetcher: SourceFetcher): Promise<GateResult> =>
    Promise.resolve(createLicenceGate().run(context({ root: REPO_ROOT, files: { [SEED]: seed }, fetcher })));

  it('passes against the committed index when every cited page loads', async () => {
    // Invented stand-ins for the cited commentary pages: the note shares no long run with them.
    const fetcher = pages(Object.fromEntries(urls.map((url) => [url, `${PSEUDO_COMMENTARY} ${url}`])));
    const result = await run(fetcher);
    expect(result.items.filter((item) => item.severity !== 'info')).toEqual([]);
    expect(result.status).toBe('pass');
    expect(result.meta).toMatchObject({ sourcesFetched: urls.length, sourcesChecked: urls.length });
  });

  it('flags every cited web source when none can be fetched', async () => {
    const result = await run(pages({}));
    expect(result.status).toBe('flag');
    const flagged = findings(result, LICENCE_RULES.commentaryUnchecked);
    expect(flagged.length).toBeGreaterThanOrEqual(urls.length);
    expect(result.items.filter((item) => item.severity === 'error')).toEqual([]);
  });
});
