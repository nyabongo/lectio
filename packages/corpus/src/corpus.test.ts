import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { byCodePoint, listSubdirectories, openCorpus, readTextFile } from './corpus.ts';
import { CorpusError } from './format.ts';

const fixtureRoot = fileURLToPath(new URL('./fixtures/corpus', import.meta.url));

const temps: string[] = [];
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'lectio-corpus-'));
  temps.push(dir);
  return dir;
}
afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('openCorpus on the fixture corpus', () => {
  const corpus = openCorpus(fixtureRoot);

  it('lists editions that have a SOURCE.json, sorted', async () => {
    expect(corpus.root).toBe(fixtureRoot);
    expect(await corpus.editions()).toEqual(['grc-test', 'hbo-test', 'lat-test']);
  });

  it('reads SOURCE.json', async () => {
    expect(await corpus.source('hbo-test')).toMatchObject({ language: 'hbo', versification: 'NABRE' });
  });

  it('returns a verse as a copy of its tokens', async () => {
    const verse = await corpus.getVerse('grc-test', 'MT', 20, 15);
    expect(verse).toHaveLength(10);
    expect(verse?.[4]).toEqual(['πονηρός', 'πονηρός', 'A-NSM']);
    verse?.pop();
    expect(await corpus.getVerse('grc-test', 'MT', '20', '15')).toHaveLength(10);
  });

  it('returns undefined for a missing chapter or verse', async () => {
    expect(await corpus.getVerse('grc-test', 'MT', 21, 1)).toBeUndefined();
    expect(await corpus.getVerse('grc-test', 'MT', 20, 99)).toBeUndefined();
    expect(await corpus.getVerse('grc-test', 'MT', 20, 'constructor')).toBeUndefined();
    expect(await corpus.getVerse('grc-test', 'MK', 1, 1)).toBeUndefined();
  });

  it('rejects unknown editions and invalid identifiers', async () => {
    await expect(corpus.getVerse('grc-none', 'MT', 1, 1)).rejects.toThrow(/unknown edition: grc-none/);
    await expect(corpus.getVerse('../x', 'MT', 1, 1)).rejects.toThrow(CorpusError);
    await expect(corpus.getVerse('grc-test', '../MT', 1, 1)).rejects.toThrow('invalid book code');
    await expect(corpus.getVerse('grc-test', 'MT', '../1', 1)).rejects.toThrow('invalid chapter');
    await expect(corpus.findWord('grc-none', 'MT', 1, 1, 'x')).rejects.toThrow(CorpusError);
  });

  it('rejects leading zeros instead of silently finding nothing', async () => {
    await expect(corpus.getVerse('grc-test', 'MT', '020', 15)).rejects.toThrow('invalid chapter: "020"');
    await expect(corpus.findWord('grc-test', 'MT', 20, '015', 'πονηρός')).rejects.toThrow('invalid verse: "015"');
    expect(await corpus.getVerse('grc-test', 'MT', 20, 0)).toBeUndefined();
  });

  describe('Greek matching is accent- and breathing-insensitive', () => {
    it.each([
      ['πονηρός', 'surface'],
      ['πονηρὸς', 'surface'],
      ['πονηρος', 'surface'],
      ['ΠΟΝΗΡΟΣ', 'surface'],
      ['εγω', 'surface'],
      ['ειμι', 'surface'],
      ['οφθαλμος', 'surface'],
    ] as const)('finds %s', async (word, match) => {
      const result = await corpus.findWord('grc-test', 'MT', 20, 15, word, { match });
      expect(result.verseFound).toBe(true);
      expect(result.matches).toHaveLength(1);
    });

    it('matches lemmas: εἰμί is the lemma of ἐστιν and εἰμι', async () => {
      const lemma = await corpus.findWord('grc-test', 'MT', 20, 15, 'εἰμί', { match: 'lemma' });
      expect(lemma.matches.map((m) => m.index)).toEqual([5, 9]);
      const surface = await corpus.findWord('grc-test', 'MT', 20, 15, 'εἰμί', { match: 'surface' });
      expect(surface.matches.map((m) => m.index)).toEqual([9]);
      const either = await corpus.findWord('grc-test', 'MT', 20, 15, 'εἰμί');
      expect(either.matches.map((m) => m.index)).toEqual([5, 9]);
      expect(either.matches[0]?.token).toEqual(['ἐστιν', 'εἰμί', 'V-PAI-3S']);
    });

    it('does not match a lemma under surface mode or a surface under lemma mode', async () => {
      expect((await corpus.findWord('grc-test', 'MT', 20, 15, 'σύ', { match: 'surface' })).matches).toEqual([]);
      expect((await corpus.findWord('grc-test', 'MT', 20, 15, 'σου', { match: 'lemma' })).matches).toEqual([]);
    });

    it('handles elided forms', async () => {
      expect((await corpus.findWord('grc-test', 'MT', 20, 16, "δι'")).matches).toHaveLength(1);
      expect((await corpus.findWord('grc-test', 'MT', 20, 16, 'ουτως')).matches).toHaveLength(1);
    });

    it('reports words that are absent and verses that are missing', async () => {
      expect(await corpus.findWord('grc-test', 'MT', 20, 15, 'ἀγάπη')).toEqual({ verseFound: true, matches: [] });
      expect(await corpus.findWord('grc-test', 'MT', 20, 15, ';')).toEqual({ verseFound: true, matches: [] });
      expect(await corpus.findWord('grc-test', 'MT', 20, 30, 'πονηρός')).toEqual({ verseFound: false, matches: [] });
    });

    it('finds phrases of consecutive tokens', async () => {
      expect(await corpus.phraseOccurs('grc-test', 'MT', 20, 15, 'ὁ ὀφθαλμός σου πονηρός')).toBe(true);
      expect(await corpus.phraseOccurs('grc-test', 'MT', 20, 15, 'ο οφθαλμοσ σου πονηροσ')).toBe(true);
      expect(await corpus.phraseOccurs('grc-test', 'MT', 20, 15, 'ἐγὼ ἀγαθός εἰμι;')).toBe(true);
      expect(await corpus.phraseOccurs('grc-test', 'MT', 20, 15, 'ἐγώ ἀγαθός εἰμί', { match: 'lemma' })).toBe(true);
      expect(await corpus.phraseOccurs('grc-test', 'MT', 20, 15, 'ὀφθαλμός πονηρός')).toBe(false);
      expect(await corpus.phraseOccurs('grc-test', 'MT', 20, 15, 'ἀγαθός εἰμι ἐγώ')).toBe(false);
      expect(await corpus.phraseOccurs('grc-test', 'MT', 20, 15, ' ; ')).toBe(false);
      expect(await corpus.phraseOccurs('grc-test', 'MT', 20, 99, 'ὁ')).toBe(false);
    });
  });

  describe('Hebrew matching is pointing-insensitive', () => {
    it.each(['בָּרָ֣א', 'ברא', 'בָּרָא', 'אֱלֹהִים', 'אלהים', 'בראשית', 'הארץ', 'הָאָרֶץ'])(
      'finds %s',
      async (word) => {
        const result = await corpus.findWord('hbo-test', 'GN', 1, 1, word, { match: 'surface' });
        expect(result.matches).toHaveLength(1);
      },
    );

    describe('OSHB "/" morpheme segmentation', () => {
      const surface = { match: 'surface' } as const;
      const indexes = async (book: string, c: number, v: number, word: string, match: 'surface' | 'lemma') =>
        (await corpus.findWord('hbo-test', book, c, v, word, { match })).matches.map((m) => m.index);

      it('matches a word without its attached prefixes (the bare word)', async () => {
        expect(await indexes('GN', 1, 1, 'שמים', 'surface')).toEqual([4]);
        expect(await indexes('GN', 1, 1, 'שָׁמַיִם', 'surface')).toEqual([4]);
        expect(await indexes('GN', 1, 1, 'ארץ', 'surface')).toEqual([6]);
        expect(await indexes('GN', 1, 1, 'ראשית', 'surface')).toEqual([0]);
        expect(await indexes('DT', 15, 9, 'רעה', 'surface')).toEqual([0]);
        expect(await indexes('DT', 15, 9, 'רָעָה', 'surface')).toEqual([0]);
      });

      it('matches the whole word, with or without the separator', async () => {
        expect(await indexes('GN', 1, 1, 'השמים', 'surface')).toEqual([4]);
        expect(await indexes('GN', 1, 1, 'הַ/שָּׁמַיִם', 'surface')).toEqual([4]);
        expect(await indexes('DT', 15, 9, 'ורעה', 'surface')).toEqual([0]);
        expect(await indexes('GN', 1, 1, 'את', 'surface')).toEqual([3, 5]);
      });

      describe('never matches a bare prefix', () => {
        const modes = ['surface', 'lemma', 'either'] as const;
        it.each(['ה', 'הַ', 'ו', 'ב', 'd', 'c', 'b'])('%s finds nothing in Gen 1:1, in any mode', async (word) => {
          for (const match of modes) {
            const result = await corpus.findWord('hbo-test', 'GN', 1, 1, word, { match });
            expect(result.matches, match).toEqual([]);
            expect(await corpus.phraseOccurs('hbo-test', 'GN', 1, 1, word, { match }), match).toBe(false);
          }
          expect(await corpus.phraseOccurs('hbo-test', 'GN', 1, 1, word)).toBe(false);
        });

        it('falls back to the last segment as stem when the morph does not line up (Deut 15:9)', async () => {
          expect(await indexes('DT', 15, 9, 'ו', 'surface')).toEqual([]);
          expect(await indexes('DT', 15, 9, 'ב', 'surface')).toEqual([]);
          expect(await indexes('DT', 15, 9, 'אחיך', 'surface')).toEqual([2]);
          expect(await indexes('DT', 15, 9, 'באחיך', 'surface')).toEqual([2]);
        });
      });

      describe('pronominal suffixes (morph segments coded S…)', () => {
        it('matches every run that contains the stem (Gen 1:11 לְ/מִינ֔/וֹ)', async () => {
          for (const word of ['מין', 'למין', 'מינו', 'למינו', 'לְמִינוֹ', 'לְ/מִינ֔/וֹ']) {
            expect(await indexes('GN', 1, 11, word, 'surface'), word).toEqual([12]);
          }
          expect(await indexes('GN', 1, 11, 'זרע', 'surface')).toEqual([7, 14]);
          expect(await indexes('GN', 1, 11, 'זרעו', 'surface')).toEqual([14]);
          expect(await corpus.phraseOccurs('hbo-test', 'GN', 1, 11, 'למינו אשר זרעו בו')).toBe(true);
          expect(await corpus.phraseOccurs('hbo-test', 'GN', 1, 11, 'מין אשר זרע', surface)).toBe(true);
        });

        it('never matches a bare suffix or prefix', async () => {
          for (const word of ['ו', 'וֹ', 'ל', 'לְ']) {
            expect(await indexes('GN', 1, 11, word, 'surface'), word).toEqual([]);
            expect(await corpus.phraseOccurs('hbo-test', 'GN', 1, 11, word), word).toBe(false);
          }
        });

        it('keeps a preposition stem with a suffix (ב֖/וֹ, morph HR/Sp3ms)', async () => {
          expect(await indexes('GN', 1, 11, 'בו', 'surface')).toEqual([15]);
          expect(await indexes('GN', 1, 11, 'ב', 'surface')).toEqual([15]);
        });

        it('treats the Aramaic postfixed article (Td) as a suffix (Dan 2:4)', async () => {
          expect(await indexes('DN', 2, 4, 'א', 'surface')).toEqual([]);
          expect(await indexes('DN', 2, 4, 'ך', 'surface')).toEqual([]);
          expect(await indexes('DN', 2, 4, 'ל', 'surface')).toEqual([]);
          expect(await indexes('DN', 2, 4, 'מלכא', 'surface')).toEqual([4]);
          expect(await indexes('DN', 2, 4, 'מלך', 'surface')).toEqual([2, 4]);
          expect(await indexes('DN', 2, 4, 'פשרא', 'surface')).toEqual([11]);
          expect(await indexes('DN', 2, 4, 'עבדיך', 'surface')).toEqual([9]);
          expect(await indexes('DN', 2, 4, 'לעבדי', 'surface')).toEqual([9]);
        });
      });

      describe("Strong's homograph letters", () => {
        it('matches a bare number against a lemma with a homograph letter', async () => {
          expect(await indexes('GN', 1, 1, '1254', 'lemma')).toEqual([1]);
          expect(await indexes('GN', 1, 7, '6213', 'lemma')).toEqual([0]);
          expect(await indexes('GN', 1, 7, 'c/6213', 'lemma')).toEqual([0]);
          expect(await indexes('GN', 1, 1, '125', 'lemma')).toEqual([]);
          expect(await indexes('GN', 1, 1, '1254', 'surface')).toEqual([]);
        });

        it('matches a named letter, spaced or not, only against that homograph', async () => {
          for (const word of ['1254 a', '1254a', '1254A'])
            expect(await indexes('GN', 1, 1, word, 'lemma'), word).toEqual([1]);
          for (const word of ['6213 a', '6213a', 'c/6213 a', 'c6213a']) {
            expect(await indexes('GN', 1, 7, word, 'lemma'), word).toEqual([0]);
          }
          expect(await indexes('GN', 1, 1, '1254 b', 'lemma')).toEqual([]);
          expect(await indexes('GN', 1, 1, '1254b', 'lemma')).toEqual([]);
        });

        it('reads "<number> <letter>" as one word in phrases', async () => {
          const lemma = { match: 'lemma' } as const;
          expect(await corpus.phraseOccurs('hbo-test', 'GN', 1, 1, '7225 1254 430', lemma)).toBe(true);
          expect(await corpus.phraseOccurs('hbo-test', 'GN', 1, 1, '7225 1254 a 430', lemma)).toBe(true);
          expect(await corpus.phraseOccurs('hbo-test', 'GN', 1, 1, 'b/7225 1254a 430', lemma)).toBe(true);
          expect(await corpus.phraseOccurs('hbo-test', 'GN', 1, 1, '7225 1254 b 430', lemma)).toBe(false);
          expect(await corpus.phraseOccurs('hbo-test', 'GN', 1, 1, 'בראשית 1254 a אלהים')).toBe(true);
          expect(await corpus.phraseOccurs('hbo-test', 'GN', 1, 1, '1254 a', lemma)).toBe(true);
        });
      });

      it('does not match a partial segment', async () => {
        expect(await indexes('GN', 1, 1, 'מים', 'surface')).toEqual([]);
        expect(await indexes('DT', 15, 9, 'ורע', 'surface')).toEqual([]);
      });

      it("matches OSHB Strong's lemmas with or without their prefix codes", async () => {
        expect(await indexes('GN', 1, 1, '8064', 'lemma')).toEqual([4]);
        expect(await indexes('GN', 1, 1, 'd/8064', 'lemma')).toEqual([4]);
        expect(await indexes('GN', 1, 1, '853', 'lemma')).toEqual([3, 5]);
        expect(await indexes('GN', 1, 1, '1254 a', 'lemma')).toEqual([1]);
        expect(await indexes('DT', 15, 9, '7489', 'lemma')).toEqual([0]);
        expect(await indexes('DT', 15, 9, 'רעה', 'lemma')).toEqual([]);
        expect((await corpus.findWord('hbo-test', 'DT', 15, 9, 'רעה')).matches).toHaveLength(1);
        expect(await corpus.phraseOccurs('hbo-test', 'GN', 1, 1, 'שמים ואת ארץ', surface)).toBe(true);
      });
    });

    it('treats maqaf as a word break in phrases', async () => {
      expect(await corpus.phraseOccurs('hbo-test', 'GN', 1, 7, 'אֶת־הָרָקִיעַ')).toBe(true);
      expect(await corpus.phraseOccurs('hbo-test', 'GN', 1, 7, 'את הרקיע')).toBe(true);
      expect(await corpus.phraseOccurs('hbo-test', 'GN', 1, 1, 'את השמים ואת הארץ')).toBe(true);
      expect(await corpus.phraseOccurs('hbo-test', 'GN', 1, 1, 'השמים הארץ')).toBe(false);
      expect((await corpus.findWord('hbo-test', 'GN', 1, 7, 'אֶת־')).matches).toHaveLength(1);
    });
  });

  describe('Latin matching', () => {
    it('folds case, j/i, æ and accents', async () => {
      expect((await corpus.findWord('lat-test', 'JN', 1, 1, 'Iesus', { match: 'surface' })).matches).toHaveLength(1);
      expect((await corpus.findWord('lat-test', 'JN', 1, 1, 'aeternus', { match: 'surface' })).matches).toHaveLength(1);
      expect((await corpus.findWord('lat-test', 'JN', 1, 1, 'dixit')).matches).toHaveLength(1);
      expect(await corpus.phraseOccurs('lat-test', 'JN', 1, 1, 'Jesus æternus')).toBe(true);
      expect((await corpus.findWord('lat-test', 'JN', 1, 1, 'ǽternus')).matches).toHaveLength(1);
    });
  });
});

describe('lazy loading and caching', () => {
  it('reads nothing on open and each file once', async () => {
    const readFile = vi.fn(readTextFile);
    const corpus = openCorpus(fixtureRoot, { readFile });
    expect(readFile).not.toHaveBeenCalled();
    await corpus.getVerse('grc-test', 'MT', 20, 15);
    await corpus.findWord('grc-test', 'MT', 20, 16, 'ἀρχῆς');
    await Promise.all([corpus.phraseOccurs('grc-test', 'MT', 20, 15, 'ὁ'), corpus.source('grc-test')]);
    expect(readFile.mock.calls.map(([path]) => path.slice(fixtureRoot.length + 1))).toEqual([
      join('grc-test', 'SOURCE.json'),
      join('grc-test', 'MT', '20.json'),
    ]);
  });

  it('caches missing chapters too', async () => {
    const readFile = vi.fn(readTextFile);
    const corpus = openCorpus(fixtureRoot, { readFile });
    await corpus.getVerse('grc-test', 'MT', 1, 1);
    await corpus.getVerse('grc-test', 'MT', 1, 2);
    expect(readFile).toHaveBeenCalledTimes(2);
  });

  it('does not cache failures, so a fixed file can be retried', async () => {
    let calls = 0;
    const readFile = vi.fn(async (path: string) => {
      calls += 1;
      if (calls <= 1) throw new Error('transient');
      return readTextFile(path);
    });
    const corpus = openCorpus(fixtureRoot, { readFile });
    await expect(corpus.source('grc-test')).rejects.toThrow('transient');
    await corpus.source('grc-test');
    let broken = true;
    const failing = openCorpus(fixtureRoot, {
      readFile: async (path) => {
        if (path.endsWith('20.json') && broken) {
          broken = false;
          return '{';
        }
        return readTextFile(path);
      },
    });
    await expect(failing.getVerse('grc-test', 'MT', 20, 15)).rejects.toThrow(/20\.json: invalid JSON/);
    expect(await failing.getVerse('grc-test', 'MT', 20, 15)).toHaveLength(10);
  });
});

describe('malformed corpora', () => {
  it('reports invalid SOURCE.json and chapter files with their path', async () => {
    const root = await tempDir();
    await mkdir(join(root, 'bad-src'), { recursive: true });
    await writeFile(join(root, 'bad-src', 'SOURCE.json'), '{"name": "x"}');
    await expect(openCorpus(root).source('bad-src')).rejects.toThrow(/bad-src.SOURCE\.json: "language" must be/);

    const good = await readFile(join(fixtureRoot, 'grc-test', 'SOURCE.json'), 'utf8');
    await mkdir(join(root, 'bad-ch', 'MT'), { recursive: true });
    await writeFile(join(root, 'bad-ch', 'SOURCE.json'), good);
    await writeFile(join(root, 'bad-ch', 'MT', '1.json'), '{"1": [["x"]]}');
    await expect(openCorpus(root).getVerse('bad-ch', 'MT', 1, 1)).rejects.toThrow(/1\.json: verse 1 token 0/);
  });

  it('ignores directories without SOURCE.json and stray files', async () => {
    const root = await tempDir();
    await mkdir(join(root, 'notes'));
    await writeFile(join(root, 'README.md'), 'x');
    expect(await openCorpus(root).editions()).toEqual([]);
    expect(await openCorpus(join(root, 'absent')).editions()).toEqual([]);
  });
});

describe('fs helpers', () => {
  it('readTextFile returns undefined only for missing files', async () => {
    const root = await tempDir();
    expect(await readTextFile(join(root, 'none.json'))).toBeUndefined();
    await writeFile(join(root, 'file'), 'x');
    expect(await readTextFile(join(root, 'file', 'below'))).toBeUndefined();
    await expect(readTextFile(root)).rejects.toThrow(/EISDIR/);
  });

  it('listSubdirectories skips files and dot-folders such as a leftover staging directory', async () => {
    const root = await tempDir();
    await mkdir(join(root, 'grc-test'));
    await mkdir(join(root, '.staging-grc-test-abc123'));
    await writeFile(join(root, 'README.md'), 'x');
    expect(await listSubdirectories(root)).toEqual(['grc-test']);
  });

  it('listSubdirectories rethrows unexpected errors', async () => {
    const root = await tempDir();
    await writeFile(join(root, 'file'), 'x');
    expect(await listSubdirectories(join(root, 'file'))).toEqual([]);
    await expect(listSubdirectories('\0bad')).rejects.toThrow();
  });

  it('byCodePoint is locale-independent', () => {
    expect(['b', 'B', 'a', 'a'].sort(byCodePoint)).toEqual(['B', 'a', 'a', 'b']);
  });
});
