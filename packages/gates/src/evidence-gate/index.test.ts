import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG } from '@lectio/config';
import type { LectioConfig } from '@lectio/config';
import { createProviders, MemorySourceFetcher, SOURCE_FIXTURES_ENV } from '@lectio/providers';
import type { FetchedSource, ProviderSet, SourceFetcher } from '@lectio/providers';

import type { ChangedFile, GateContext, GateResultItem } from '../index.ts';
import { createContext, formatFinding, ruleBookFor } from '../index.ts';
import { GATES } from '../registry.ts';
import type { EvidenceCorpus } from './index.ts';
import { EVIDENCE_RULES, createEvidenceGate, evidenceGate } from './index.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..', '..');
const FIXTURES = join(HERE, 'fixtures');
const PAGES = join(FIXTURES, 'pages');

type Json = Record<string, unknown>;

function fixture(name: string): Json {
  return JSON.parse(readFileSync(join(FIXTURES, 'passages', `${name}.json`), 'utf8')) as Json;
}

const SEED = JSON.parse(readFileSync(join(REPO_ROOT, 'passages', 'MT.20.1-16.json'), 'utf8')) as Json;

interface RunOptions {
  readonly files?: Readonly<Record<string, string | Json | null>>;
  readonly changed?: readonly ChangedFile[];
  readonly providers?: ProviderSet;
  readonly config?: LectioConfig;
  readonly corpus?: (root: string) => EvidenceCorpus;
}

function context(options: RunOptions): GateContext {
  const files = options.files ?? {};
  const changed = options.changed ?? Object.keys(files).map((path): ChangedFile => ({ path, status: 'modified' }));
  return createContext({
    root: REPO_ROOT,
    base: 'origin/main',
    head: 'HEAD',
    config: options.config ?? DEFAULT_CONFIG,
    providers: options.providers ?? createProviders(DEFAULT_CONFIG, { [SOURCE_FIXTURES_ENV]: PAGES }),
    git: { changedFiles: () => [...changed], show: () => null },
    readText: (path) => {
      const value = files[path.slice(REPO_ROOT.length + 1)];
      if (value === undefined || value === null) return null;
      return typeof value === 'string' ? value : JSON.stringify(value);
    },
  });
}

async function run(passage: Json, options: RunOptions = {}) {
  const gate = options.corpus === undefined ? evidenceGate : createEvidenceGate({ corpus: options.corpus });
  return gate.run(context({ files: { 'passages/MT.20.1-16.json': passage }, ...options }));
}

const summary = (items: readonly { ruleId: string; severity: string; claimId?: string; pointer: string }[]) =>
  items.map(({ ruleId, severity, claimId, pointer }) => `${ruleId} ${severity} ${claimId ?? '-'} ${pointer}`);

/** A fetcher answering every URL with `page` (or throwing `error`). */
function stubFetcher(page: Partial<FetchedSource> & Record<string, unknown>, error?: Error): SourceFetcher {
  return {
    fetch: (url) =>
      error === undefined
        ? Promise.resolve({
            status: 200,
            text: '',
            contentType: 'text/html',
            retrievedAt: '2026-10-05T00:00:00Z',
            finalUrl: url,
            ...page,
          })
        : Promise.reject(error),
  };
}

function providersWith(fetcher: SourceFetcher): ProviderSet {
  const providers = createProviders(DEFAULT_CONFIG);
  return { ...providers, fetcher, fakes: new Set([...providers.fakes].filter((slot) => slot !== 'fetcher')) };
}

describe('evidenceGate', () => {
  it('is registered under its id and declares the four rules', () => {
    expect(GATES).toContain(evidenceGate);
    expect(evidenceGate.id).toBe('evidence');
    expect(evidenceGate.rules.map((rule) => rule.id)).toEqual([
      'evidence/web-excerpt-found',
      'evidence/scripture-source-real',
      'evidence/original-word-in-verse',
      'evidence/print-source-flag',
    ]);
    expect(() => ruleBookFor([evidenceGate])).not.toThrow();
  });

  it('passes a fixture whose excerpts, scripture quotes and original words all check out', async () => {
    const result = await run(fixture('valid'));
    expect(result.items).toEqual([]);
    expect(result).toMatchObject({ status: 'pass', meta: { fetch: 'fixtures', files: ['passages/MT.20.1-16.json'] } });
  });

  it('fails a note on the wrong verse and a scripture excerpt cited at the wrong verse', async () => {
    const result = await run(fixture('wrong-verse'));
    expect(result.status).toBe('fail');
    expect(summary(result.items)).toEqual([
      'evidence/scripture-source-real error c1 /sources/0/excerpt',
      'evidence/original-word-in-verse error c2 /translationNotes/0/original/text',
    ]);
    expect(result.items[0]?.message).toBe(
      'claim c1 cites source "mt-20-2", which quotes “ἐκ δηναρίου τὴν ἡμέραν”, which does not occur in Mt 20:3 (grc-sblgnt)',
    );
    expect(result.items[1]?.message).toBe(
      'translation note "evil-eye" (claim c2) quotes “ὀφθαλμός σου πονηρός”, but “ὀφθαλμός”, “σου”, “πονηρός” do not occur in MT 20:14 (grc-sblgnt)',
    );
  });

  it('fails misspelt Greek in a note and a misspelt Hebrew excerpt', async () => {
    const result = await run(fixture('misspelt-greek'));
    expect(summary(result.items)).toEqual([
      'evidence/scripture-source-real error c2 /sources/1/excerpt',
      'evidence/original-word-in-verse error c2 /translationNotes/0/original/text',
    ]);
    expect(result.items[1]?.message).toContain('“πονειρός” does not occur in MT 20:15');
  });

  it('fails an excerpt that is not on the fetched page, naming the claim and the source', async () => {
    const result = await run(fixture('excerpt-not-on-page'));
    expect(result.status).toBe('fail');
    expect(summary(result.items)).toEqual(['evidence/web-excerpt-found error c1 /sources/2/excerpt']);
    expect(formatFinding(result.items[0] as never, ruleBookFor([evidenceGate]))).toContain(
      'claim c1 cites source "commentary-denarius", which quotes “A denarius was twice the usual wage”, which is not on https://commentary.example.org/mt/20-2',
    );
  });

  it('flags a claim resting on a print source', async () => {
    const result = await run(fixture('print-source'));
    expect(result.status).toBe('flag');
    expect(summary(result.items)).toEqual(['evidence/print-source-flag warning c1 /sources/4']);
    expect(result.items[0]?.message).toContain('is a print source (A. Writer, A Fixture Commentary on Matthew');
  });

  it('flags, and does not pass or fail, a page that returns 404', async () => {
    const result = await run(fixture('fetch-404'));
    expect(result.status).toBe('flag');
    expect(summary(result.items)).toEqual(['evidence/web-excerpt-found warning c2 /sources/3/url']);
    expect(result.items[0]?.message).toContain(
      'could not be checked: fetching https://commentary.example.org/mt/missing returned HTTP 404',
    );
  });

  describe('over the real seed note (passages/MT.20.1-16.json)', () => {
    it('finds every scripture excerpt and original word in the corpus; unfetched pages are flagged', async () => {
      const result = await run(SEED);
      const byRule = (id: string) => result.items.filter((item) => item.ruleId === id);
      expect(byRule(EVIDENCE_RULES.scriptureSourceReal.id)).toEqual([]);
      expect(byRule(EVIDENCE_RULES.originalWordInVerse.id)).toEqual([]);
      expect(byRule(EVIDENCE_RULES.printSourceFlag.id)).toEqual([]);
      const web = byRule(EVIDENCE_RULES.webExcerptFound.id);
      expect(web.length).toBeGreaterThan(0);
      expect(web.every((item) => item.severity === 'warning' && item.message.includes('HTTP 404'))).toBe(true);
      expect(result.status).toBe('flag');
    });

    it('passes when every page carries its excerpt, fetching a shared page once', async () => {
      const sources = SEED['sources'] as { type: string; url?: string; excerpt?: string }[];
      const pages: Record<string, { text: string }> = {};
      for (const source of sources) {
        if (source.type !== 'web') continue;
        const url = source.url as string;
        pages[url] = { text: `${pages[url]?.text ?? ''}<p>${source.excerpt as string}</p>\n` };
      }
      const fetcher = new MemorySourceFetcher(pages);
      const result = await run(SEED, { providers: providersWith(fetcher) });
      expect(result.items).toEqual([]);
      expect(result.meta['fetch']).toBe('live');
      expect(fetcher.fetched.length).toBe(Object.keys(pages).length);
    });

    it('fails when a note is moved to another verse or its Greek is misspelt', async () => {
      const notes = structuredClone(SEED['translationNotes']) as { verse: string; original: { text: string } }[];
      (notes[0] as (typeof notes)[number]).verse = '20:13';
      (notes[1] as (typeof notes)[number]).original.text = 'ἀγαθώς';
      const result = await run({ ...SEED, translationNotes: notes });
      const failures = result.items.filter((item) => item.severity === 'error');
      expect(summary(failures)).toEqual([
        'evidence/original-word-in-verse error c12 /translationNotes/0/original/text',
        'evidence/original-word-in-verse error c15 /translationNotes/1/original/text',
      ]);
      expect(failures[0]?.message).toContain('(claims c12, c13, c14)');
    });
  });

  describe('web sources', () => {
    const withEyePage = (page: Partial<FetchedSource> & Record<string, unknown>, error?: Error) =>
      run(fixture('valid'), { providers: providersWith(stubFetcher(page, error)) });

    it('flags a PDF or other unsupported body from the live fetcher', async () => {
      const pdf = await withEyePage({ unsupported: 'pdf', contentType: 'application/pdf' });
      expect(pdf.status).toBe('flag');
      expect(pdf.items[0]?.message).toContain('is a pdf document (application/pdf) the gate cannot read');
      const other = await withEyePage({ unsupported: true, contentType: 'image/png' });
      expect(other.items[0]?.message).toContain('is an unsupported document (image/png)');
    });

    it('treats unsupported: false as a readable page', async () => {
      const result = await withEyePage({ unsupported: false, text: 'nothing relevant' });
      expect(result.items.map((item) => item.severity)).toEqual(['error', 'error']);
    });

    it('flags a page with no text and a fetch that throws', async () => {
      const empty = await withEyePage({ text: '  ' });
      expect(empty.items[0]?.message).toContain('https://commentary.example.org/mt/20-2 returned no text');
      const failed = await withEyePage({}, new Error('connect ECONNREFUSED'));
      expect(failed.status).toBe('flag');
      expect(failed.items[0]?.message).toContain('failed (connect ECONNREFUSED)');
      const thrown = await run(fixture('valid'), {
        providers: providersWith({ fetch: () => Promise.reject(new Error('boom')) }),
      });
      expect(thrown.items).toHaveLength(2);
      const odd = await run(fixture('valid'), {
        providers: providersWith({
          fetch: () => Promise.reject('plain string' as unknown as Error),
        }),
      });
      expect(odd.items[0]?.message).toContain('failed (plain string)');
    });

    it('checks the archived copy when the page is gone, and names it on a miss', async () => {
      const passage = fixture('fetch-404');
      const sources = passage['sources'] as Json[];
      (sources[3] as Json)['archivedUrl'] = 'https://web.archive.org/web/2026/https://commentary.example.org/mt/20-15';
      const fetcher = new MemorySourceFetcher({
        'https://web.archive.org/web/2026/https://commentary.example.org/mt/20-15': {
          text: 'an evil eye meant a grudging spirit; a good eye meant a generous one',
        },
        'https://commentary.example.org/mt/20-2': { text: 'unrelated' },
      });
      const result = await run(passage, { providers: providersWith(fetcher) });
      expect(summary(result.items)).toEqual(['evidence/web-excerpt-found error c1 /sources/2/excerpt']);
      (sources[3] as Json)['excerpt'] = 'a different sentence';
      const miss = await run(passage, { providers: providersWith(fetcher) });
      expect(miss.items[1]?.message).toContain(
        'is not on the archived copy https://web.archive.org/web/2026/https://commentary.example.org/mt/20-15',
      );
    });

    it('shortens a long excerpt in the message', async () => {
      const passage = fixture('valid');
      (passage['sources'] as Json[])[2] = { ...(passage['sources'] as Json[])[2], excerpt: 'word '.repeat(30).trim() };
      const result = await run(passage);
      expect(result.items[0]?.message).toContain(`quotes “${'word '.repeat(15)}wo…”, which is not on`);
    });

    describe('stitched or fragmentary excerpts', () => {
      const page = 'The labourers went into the vineyard at dawn and were paid by the owner at evening.';
      const withExcerpt = (excerpt: string, text: string = page) => {
        const passage = fixture('valid');
        (passage['sources'] as Json[])[2] = { ...(passage['sources'] as Json[])[2], excerpt };
        const fetcher = new MemorySourceFetcher({
          'https://commentary.example.org/mt/20-2': { text },
          'https://commentary.example.org/mt/20-15': {
            text: 'an evil eye meant much; a good eye meant a generous one',
          },
        });
        return run(passage, { providers: providersWith(fetcher) });
      };

      it('fails a bare substring or fragments that are not whole words of the page', async () => {
        for (const excerpt of ['he', 'The ... vine ... paid ... a']) {
          const result = await withExcerpt(excerpt);
          expect(summary(result.items)).toEqual(['evidence/web-excerpt-found error c1 /sources/2/excerpt']);
        }
      });

      it('flags an excerpt on the page that is too short to verify', async () => {
        for (const excerpt of ['vineyard', 'The labourers went … at evening']) {
          const result = await withExcerpt(excerpt);
          expect(summary(result.items)).toEqual(['evidence/web-excerpt-found warning c1 /sources/2/excerpt']);
          expect(result.items[0]?.message).toContain('is too short to verify: quote at least 3 words');
        }
        expect((await withExcerpt('The labourers went … were paid by')).items).toEqual([]);
      });

      it('matches an excerpt that spans inline links, emphasis, curly quotes and Greek', async () => {
        const html =
          '<p>The word <a href="/greek/2083.htm">Ἑ<i>ταῖρε</i></a> is used, as in <a href="/matthew/22-12.htm">Matthew 22:12</a>, ' +
          'of the <b>guest</b> without the &ldquo;wedding garment&rdquo; and of Judas.</p><p>Next paragraph.</p>';
        const excerpt = 'The word Ἑταῖρε is used, as in Matthew 22:12, of the guest without the “wedding garment”';
        expect((await withExcerpt(excerpt, html)).items).toEqual([]);
        expect((await withExcerpt('and of Judas. Next paragraph.', html)).items).toEqual([]);
        expect((await withExcerpt('of Judas.Next paragraph', html)).status).toBe('fail');
        const numbered = '<p><sup>1</sup>The kingdom of heaven is like a householder.</p>';
        expect((await withExcerpt('The kingdom of heaven', numbered)).items).toEqual([]);
      });

      it('fails pieces that lie far apart on the page', async () => {
        const far = `${page} ${'filler words here. '.repeat(40)} The owner spoke kindly to them.`;
        expect((await withExcerpt('The labourers went … owner spoke kindly', far)).status).toBe('fail');
        expect((await withExcerpt('were paid by … The owner spoke', far)).status).toBe('fail');
      });
    });

    it('flags a web source without an excerpt, or with only an ellipsis', async () => {
      const passage = fixture('valid');
      const sources = passage['sources'] as Json[];
      delete (sources[2] as Json)['excerpt'];
      delete (sources[2] as Json)['excerptLang'];
      (sources[3] as Json)['excerpt'] = '…';
      const result = await run(passage);
      expect(summary(result.items)).toEqual([
        'evidence/web-excerpt-found warning c1 /sources/2',
        'evidence/web-excerpt-found warning c2 /sources/3',
      ]);
      expect(result.items[0]?.message).toContain(
        'has no excerpt to check against https://commentary.example.org/mt/20-2',
      );
    });

    it('reports a source no claim cites under the source alone, and one finding per citing claim', async () => {
      const passage = fixture('print-source');
      const claims = passage['claims'] as { sourceIds: string[] }[];
      (claims[0] as (typeof claims)[number]).sourceIds = ['mt-20-2', 'commentary-denarius'];
      const uncited = await run(passage);
      expect(summary(uncited.items)).toEqual(['evidence/print-source-flag warning - /sources/4']);
      expect(uncited.items[0]?.message).toMatch(/^source "print-commentary" is a print source/u);
      (claims[0] as (typeof claims)[number]).sourceIds = ['print-commentary'];
      (claims[1] as (typeof claims)[number]).sourceIds = ['dt-15-9', 'print-commentary'];
      const twice = await run(passage);
      expect(summary(twice.items)).toEqual([
        'evidence/print-source-flag warning c1 /sources/4',
        'evidence/print-source-flag warning c2 /sources/4',
      ]);
    });
  });

  describe('scripture sources', () => {
    const withSource = (source: Json, options: RunOptions = {}) => {
      const passage = fixture('valid');
      (passage['sources'] as Json[])[0] = { id: 'mt-20-2', type: 'scripture', citation: 'Scripture', ...source };
      return run(passage, options);
    };

    it('fails a ref that does not parse or is not a real verse', async () => {
      const unparsable = await withSource({ ref: 'Hezekiah 3:1' });
      expect(summary(unparsable.items)).toEqual(['evidence/scripture-source-real error c1 /sources/0/ref']);
      expect(unparsable.items[0]?.message).toContain('has a ref “Hezekiah 3:1” that does not parse');
      const unreal = await withSource({ ref: 'Mt 20:35' });
      expect(unreal.items[0]?.message).toContain('cites “Mt 20:35”, which is not a real verse');
    });

    it('accepts a ref without an excerpt, and flags an excerpt the corpus cannot check', async () => {
      expect((await withSource({ ref: 'Mt 20:9-10' })).items).toEqual([]);
      const english = await withSource({ ref: 'Mt 20:2', excerpt: 'a denarius', excerptLang: 'en' });
      expect(summary(english.items)).toEqual(['evidence/scripture-source-real warning c1 /sources/0/excerpt']);
      expect(english.items[0]?.message).toContain(
        'has an excerpt (tagged "en") that is not Greek, Hebrew, Aramaic or Latin, so it cannot be checked',
      );
      const untagged = await withSource({ ref: 'Mt 20:2', excerpt: 'denarius' });
      expect(untagged.items[0]?.message).toContain('has an excerpt that is not Greek');
    });

    it('checks Greek or Hebrew script whatever excerptLang says, and fails the missing or wrong tag', async () => {
      // A fabricated excerpt: these words are not in Mt 19:27.
      for (const tag of [undefined, 'el']) {
        const result = await withSource({
          ref: 'Mt 19:27',
          excerpt: 'ὁ Ἰησοῦς ἐδάκρυσεν',
          ...(tag === undefined ? {} : { excerptLang: tag }),
        });
        expect(summary(result.items)).toEqual([
          'evidence/scripture-source-real error c1 /sources/0/excerptLang',
          'evidence/scripture-source-real error c1 /sources/0/excerpt',
        ]);
        expect(result.items[1]?.message).toContain('does not occur in Mt 19:27 (grc-sblgnt)');
      }
      const untagged = await withSource({ ref: 'Mt 19:27', excerpt: 'Πέτρος' });
      expect(summary(untagged.items)).toEqual(['evidence/scripture-source-real error c1 /sources/0/excerptLang']);
      expect(untagged.items[0]?.message).toContain(
        'quotes Greek script, but its excerpt has no excerptLang; tag it "grc"',
      );
      // Even an `en` or `lat` tag: Greek script is checked as Greek, and the tag is an error.
      for (const tag of ['en', 'lat']) {
        const mistagged = await withSource({ ref: 'Mt 19:27', excerpt: 'Πέτρος', excerptLang: tag });
        expect(summary(mistagged.items)).toEqual(['evidence/scripture-source-real error c1 /sources/0/excerptLang']);
      }
      const aramaic = await withSource({ ref: 'Dn 3:91', excerpt: 'נְבוּכַדְנֶצַּר', excerptLang: 'arc' });
      expect(aramaic.items).toEqual([]);
      const hebrew = await withSource({ ref: 'Dt 15:9', excerpt: 'וְרָעָה עֵינְךָ', excerptLang: 'he' });
      expect(summary(hebrew.items)).toEqual(['evidence/scripture-source-real error c1 /sources/0/excerptLang']);
      expect(hebrew.items[0]?.message).toContain('is tagged "he"; tag it "hbo" (or "arc" for Aramaic)');
    });

    it('reads Greek Esther’s lettered chapters from the Septuagint', async () => {
      expect((await withSource({ ref: 'Est C:12', excerpt: 'Ἐσθὴρ ἡ βασίλισσα', excerptLang: 'grc' })).items).toEqual(
        [],
      );
      const wrong = await withSource({ ref: 'Est C:13', excerpt: 'Ἐσθὴρ ἡ βασίλισσα', excerptLang: 'grc' });
      expect(wrong.items[0]?.severity).toBe('warning'); // found in the adjacent verse C:12
      expect(wrong.items[0]?.message).toContain('grc-lxx has only when Est C:12 is included');
    });

    it('flags, not fails, Septuagint text found only across a neighbouring verse boundary', async () => {
      const sirach = await withSource({ ref: 'Sir 3:26', excerpt: 'βαρυνθήσεται πόνοις', excerptLang: 'grc' });
      expect(summary(sirach.items)).toEqual(['evidence/scripture-source-real warning c1 /sources/0/excerpt']);
      expect(sirach.items[0]?.message).toBe(
        'claim c1 cites source "mt-20-2", which quotes “βαρυνθήσεται πόνοις”, which grc-lxx has only when Sir 3:27 is included: its verse boundaries can differ from the cited numbering, so a reviewer must check the ref',
      );
      const maccabees = await withSource({ ref: '2 Mc 4:20', excerpt: 'θυσίαν', excerptLang: 'grc' });
      expect(maccabees.items[0]?.message).toContain('grc-lxx has only when 2 Mc 4:19 is included');
      const both = await withSource({ ref: '2 Mc 4:19', excerpt: 'βασιλέως παρόντος … τριηρέων', excerptLang: 'grc' });
      expect(both.items[0]?.message).toContain('only when 2 Mc 4:18 and 2 Mc 4:20 are included');
      // Swete's text has no Sir 3:25: text from a neighbouring verse is a boundary warning.
      const unnumbered = await withSource({ ref: 'Sir 3:25', excerpt: 'ὑπόνοια πονηρὰ', excerptLang: 'grc' });
      expect(summary(unnumbered.items)).toEqual(['evidence/scripture-source-real warning c1 /sources/0/ref']);
      expect(unnumbered.items[0]?.message).toContain(
        'cites Sir 3:25, which grc-lxx does not number; the excerpt is in Sir 3:24',
      );
      const nowhere = await withSource({ ref: 'Sir 3:25', excerpt: 'ἐδάκρυσεν', excerptLang: 'grc' });
      expect(summary(nowhere.items)).toEqual(['evidence/scripture-source-real error c1 /sources/0/ref']);
      const absent = await withSource({ ref: 'Sir 3:26', excerpt: 'ἐδάκρυσεν', excerptLang: 'grc' });
      expect(summary(absent.items)).toEqual(['evidence/scripture-source-real error c1 /sources/0/excerpt']);
      // The tolerance is for the Septuagint only.
      const gospel = await withSource({ ref: 'Mt 20:14', excerpt: 'ὀφθαλμός σου πονηρός', excerptLang: 'grc' });
      expect(gospel.items[0]?.severity).toBe('error');
    });

    it('matches an excerpt across the verses of a range and pieces around an ellipsis', async () => {
      expect(
        (await withSource({ ref: 'Mt 6:22-23', excerpt: 'ὀφθαλμός σου πονηρὸς', excerptLang: 'grc' })).items,
      ).toEqual([]);
      expect((await withSource({ ref: 'Mt 20:15', excerpt: 'ὀφθαλμός … πονηρός', excerptLang: 'grc' })).items).toEqual(
        [],
      );
      const reversed = await withSource({ ref: 'Mt 20:15', excerpt: 'πονηρός … ὀφθαλμός', excerptLang: 'grc' });
      expect(reversed.status).toBe('fail');
      const blank = await withSource({ ref: 'Mt 20:15', excerpt: '…', excerptLang: 'grc' });
      expect(blank.status).toBe('fail');
    });

    it('checks Latin against the Vulgate in its own numbering', async () => {
      // Hebrew Ps 23 is Vulgate Ps 22.
      expect((await withSource({ ref: 'Ps 23:1', excerpt: 'Dominus regit me', excerptLang: 'lat' })).items).toEqual([]);
      expect((await withSource({ ref: 'Ps 24:1', excerpt: 'Dominus regit me', excerptLang: 'lat' })).status).toBe(
        'fail',
      );
    });

    it('fails Hebrew quoted for a New Testament verse', async () => {
      const result = await withSource({ ref: 'Mt 20:2', excerpt: 'עֵינְךָ', excerptLang: 'hbo' });
      expect(summary(result.items)).toEqual(['evidence/scripture-source-real error c1 /sources/0/excerptLang']);
      expect(result.items[0]?.message).toContain(
        'quotes Hebrew for Mt 20:2, but Matthew has no Hebrew or Aramaic original',
      );
    });

    it('flags Greek of an Old Testament book the corpus does not hold yet, and fails a verse the edition lacks', async () => {
      const corpus = (): EvidenceCorpus => ({
        edition: (id) => Promise.resolve(id === 'grc-lxx' ? undefined : { language: 'hbo', versification: 'original' }),
        hasBook: (_edition, book) => Promise.resolve(book !== 'SIR'),
        getVerse: () => Promise.resolve(undefined),
      });
      const first = (items: readonly GateResultItem[]) => items.filter((item) => item.pointer.startsWith('/sources/0'));
      const lxx = await withSource({ ref: 'Gn 1:1', excerpt: 'ἐν ἀρχῇ', excerptLang: 'grc' }, { corpus });
      expect(summary(first(lxx.items))).toEqual(['evidence/scripture-source-real warning c1 /sources/0/excerpt']);
      expect(first(lxx.items)[0]?.message).toContain('could not be checked: the corpus has no edition grc-lxx yet');
      const sirach = await withSource({ ref: 'Sir 1:1', excerpt: 'חכמה', excerptLang: 'hbo' }, { corpus });
      expect(first(sirach.items)[0]?.message).toContain('could not be checked: hbo-oshb has no Sirach');
      const lost = await withSource({ ref: 'Gn 1:1', excerpt: 'בראשית', excerptLang: 'hbo' }, { corpus });
      expect(summary(first(lost.items))).toEqual(['evidence/scripture-source-real error c1 /sources/0/ref']);
      expect(first(lost.items)[0]?.message).toContain('cites Gn 1:1, which is not in hbo-oshb');
    });
  });

  describe('translation notes', () => {
    const withNote = (note: Json, options: RunOptions = {}) => {
      const passage = fixture('valid');
      const notes = passage['translationNotes'] as Json[];
      notes[0] = { ...(notes[0] as Json), ...note };
      return run(passage, options);
    };

    it('accepts dictionary forms (lemmas) and words the verse separates', async () => {
      expect(
        (await withNote({ verse: '20:2', original: { text: 'δηνάριον', lang: 'grc', translit: 'x', gloss: 'x' } }))
          .items,
      ).toEqual([]);
      expect(
        (await withNote({ original: { text: 'ὀφθαλμός … ἀγαθός', lang: 'grc', translit: 'x', gloss: 'x' } })).items,
      ).toEqual([]);
    });

    it('fails a note whose original text has no words', async () => {
      const result = await withNote({ original: { text: '·', lang: 'grc', translit: 'x', gloss: 'x' } });
      expect(summary(result.items)).toEqual([
        'evidence/original-word-in-verse error c2 /translationNotes/0/original/text',
      ]);
      expect(result.items[0]?.message).toContain('quotes “·”, which has no words to check');
    });

    it('flags, not fails, a Septuagint word found in the neighbouring verse', async () => {
      const passage: Json = { ...fixture('valid'), key: 'SIR.3.17-29', ref: 'Sir 3:17-29' };
      const notes = passage['translationNotes'] as Json[];
      notes[0] = {
        ...(notes[0] as Json),
        verse: '3:26',
        original: { text: 'βαρυνθήσεται πόνοις', lang: 'grc', translit: 'x', gloss: 'x' },
      };
      notes[1] = {
        ...(notes[1] as Json),
        verse: '3:26',
        original: { text: 'ἐδάκρυσεν', lang: 'grc', translit: 'x', gloss: 'x' },
      };
      const result = await run(passage);
      const noteItems = result.items.filter((item) => item.pointer.startsWith('/translationNotes'));
      expect(summary(noteItems)).toEqual([
        'evidence/original-word-in-verse warning c2 /translationNotes/0/original/text',
        'evidence/original-word-in-verse error c1 /translationNotes/1/original/text',
      ]);
      expect(noteItems[0]?.message).toContain('“πόνοις” grc-lxx has only in Sir 3:27');
      notes[0] = {
        ...(notes[0] as Json),
        verse: '3:25',
        original: { text: 'ὑπόνοια', lang: 'grc', translit: 'x', gloss: 'x' },
      };
      notes[1] = { ...(notes[1] as Json), verse: '3:25' };
      const unnumbered = (await run(passage)).items.filter((item) => item.pointer.startsWith('/translationNotes'));
      expect(summary(unnumbered)).toEqual([
        'evidence/original-word-in-verse warning c2 /translationNotes/0/verse',
        'evidence/original-word-in-verse error c1 /translationNotes/1/verse',
      ]);
      expect(unnumbered[0]?.message).toContain(
        'is on SIR 3:25, which grc-lxx does not number; its words are in Sir 3:24',
      );
    });

    it('fails a verse that does not exist in the book', async () => {
      const result = await withNote({ verse: '20:99' });
      expect(summary(result.items)).toEqual(['evidence/original-word-in-verse error c2 /translationNotes/0/verse']);
      expect(result.items[0]?.message).toContain('is on MT 20:99, which is not a real verse');
    });

    it('fails Hebrew quoted in a Gospel note', async () => {
      const result = await withNote({ original: { text: 'עַיִן', lang: 'hbo', translit: 'ayin', gloss: 'eye' } });
      expect(summary(result.items)).toEqual([
        'evidence/original-word-in-verse error c2 /translationNotes/0/original/lang',
      ]);
      expect(result.items[0]?.message).toContain('quotes Hebrew, but Matthew has no Hebrew or Aramaic original');
    });

    it('flags a note it cannot check and fails a verse missing from the edition', async () => {
      const missingEdition = (): EvidenceCorpus => ({
        edition: () => Promise.resolve(undefined),
        hasBook: () => Promise.resolve(true),
        getVerse: () => Promise.resolve(undefined),
      });
      const flagged = await withNote({}, { corpus: missingEdition });
      expect(summary(flagged.items)).toContain(
        'evidence/original-word-in-verse warning c2 /translationNotes/0/original/text',
      );
      const emptyEdition = (): EvidenceCorpus => ({
        ...missingEdition(),
        edition: () => Promise.resolve({ language: 'grc', versification: 'original' }),
      });
      const lost = await withNote({}, { corpus: emptyEdition });
      expect(lost.items.find((item) => item.pointer === '/translationNotes/0/verse')?.message).toContain(
        'is on MT 20:15, which is not in grc-sblgnt',
      );
    });
  });

  describe('which files it checks', () => {
    it('checks only passage files the PR adds or changes, and leaves invalid files to the schema gate', async () => {
      const result = await evidenceGate.run(
        context({
          files: {
            'passages/MT.20.1-16.json': fixture('valid'),
            'passages/BROKEN.json': '{ not json',
            'passages/INVALID.json': { key: 'nope' },
            'passages/sub/NESTED.json': fixture('print-source'),
            'calendar/2026.json': fixture('print-source'),
            'passages/GONE.json': fixture('print-source'),
          },
          changed: [
            { path: 'calendar/2026.json', status: 'added' },
            { path: 'passages/BROKEN.json', status: 'added' },
            { path: 'passages/GONE.json', status: 'deleted' },
            { path: 'passages/INVALID.json', status: 'added' },
            { path: 'passages/MISSING.json', status: 'added' },
            { path: 'passages/MT.20.1-16.json', status: 'modified' },
            { path: 'passages/sub/NESTED.json', status: 'added' },
          ],
        }),
      );
      expect(result).toMatchObject({
        status: 'pass',
        meta: {
          files: ['passages/MT.20.1-16.json'],
          invalidFiles: ['passages/BROKEN.json', 'passages/INVALID.json', 'passages/MISSING.json'],
        },
      });
    });

    it('looks for passages under the configured content root', async () => {
      const config = { ...DEFAULT_CONFIG, content: { ...DEFAULT_CONFIG.content, root: './content/' } };
      const result = await evidenceGate.run(
        context({
          config,
          files: {
            'content/passages/MT.20.1-16.json': fixture('print-source'),
            'passages/MT.20.1-16.json': fixture('print-source'),
          },
        }),
      );
      expect(result.meta['files']).toEqual(['content/passages/MT.20.1-16.json']);
      expect(result.status).toBe('flag');
    });

    it('passes a PR that changes no passage', async () => {
      const result = await evidenceGate.run(context({}));
      expect(result).toEqual({ gate: 'evidence', status: 'pass', items: [], meta: { fetch: 'fixtures', files: [] } });
    });
  });
});
