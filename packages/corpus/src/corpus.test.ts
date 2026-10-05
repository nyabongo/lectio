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
    it.each(['בָּרָ֣א', 'ברא', 'בָּרָא', 'אֱלֹהִים', 'אלהים', 'בראשית', 'הארץ', 'הָאָרֶץ'])('finds %s', async (word) => {
      const result = await corpus.findWord('hbo-test', 'GN', 1, 1, word, { match: 'surface' });
      expect(result.matches).toHaveLength(1);
    });

    it('matches unpointed lemmas', async () => {
      const result = await corpus.findWord('hbo-test', 'GN', 1, 1, 'את', { match: 'lemma' });
      expect(result.matches.map((m) => m.index)).toEqual([3, 5]);
      expect((await corpus.findWord('hbo-test', 'GN', 1, 1, 'ארץ', { match: 'lemma' })).matches).toHaveLength(1);
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
