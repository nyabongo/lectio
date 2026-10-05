import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { resolveCorpusRoot, runFind, runLicences } from './run.ts';

const fixtureRoot = fileURLToPath(new URL('../fixtures/corpus', import.meta.url));
const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, io: { out: (line: string) => out.push(line), err: (line: string) => err.push(line) } };
}

const temps: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('runFind', () => {
  it('prints the matching tokens of the verse (the issue example)', async () => {
    const { out, err, io } = capture();
    expect(await runFind(['grc-test', 'MT', '20', '15', 'πονηρός'], fixtureRoot, io)).toBe(0);
    expect(out).toEqual([
      'grc-test MT 20:15: "πονηρός" found (match: either)',
      '  word 5: πονηρός  lemma πονηρός  morph A-NSM',
    ]);
    expect(err).toEqual([]);
  });

  it('accepts --match in both spellings and prints tokens without morphology', async () => {
    const a = capture();
    expect(await runFind(['grc-test', 'MT', '20', '16', 'οὕτως', '--match', 'surface'], fixtureRoot, a.io)).toBe(0);
    expect(a.out[1]).toBe('  word 1: Οὕτως  lemma οὕτως');
    const b = capture();
    expect(await runFind(['--match=lemma', 'grc-test', 'MT', '20', '15', 'εἰμί'], fixtureRoot, b.io)).toBe(0);
    expect(b.out).toHaveLength(3);
  });

  it('prints "-" for an empty lemma', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lectio-cli-'));
    temps.push(root);
    await mkdir(join(root, 'lat-x', 'JN'), { recursive: true });
    await writeFile(
      join(root, 'lat-x', 'SOURCE.json'),
      JSON.stringify({
        name: 'x',
        language: 'lat',
        upstreamUrl: 'u',
        version: 'v',
        sha256: '0'.repeat(64),
        licence: 'CC0-1.0',
        attribution: 'a',
        versification: 'Vulgate',
      }),
    );
    await writeFile(join(root, 'lat-x', 'JN', '1.json'), '{"1": [["verbum", ""]]}');
    const { out, io } = capture();
    expect(await runFind(['lat-x', 'JN', '1', '1', 'Verbum'], root, io)).toBe(0);
    expect(out[1]).toBe('  word 1: verbum  lemma -');
  });

  it('looks up a single maqaf-joined argument as a phrase', async () => {
    const { out, io } = capture();
    expect(await runFind(['hbo-test', 'GN', '1', '7', 'אֶת־הָרָקִיעַ'], fixtureRoot, io)).toBe(0);
    expect(out).toEqual(['hbo-test GN 1:7: phrase "אֶת־הָרָקִיעַ" occurs (match: either)']);
  });

  it('finds a Hebrew word without its prefix (Deut 15:9 רעה)', async () => {
    const { out, io } = capture();
    expect(await runFind(['hbo-test', 'DT', '15', '9', 'רעה', '--match', 'surface'], fixtureRoot, io)).toBe(0);
    expect(out[1]).toBe('  word 1: וְ/רָעָ֣ה  lemma c/7489  morph HC/Vqp3fs');
  });

  it('looks up several words as a phrase', async () => {
    const yes = capture();
    expect(await runFind(['hbo-test', 'GN', '1', '7', 'את', 'הרקיע'], fixtureRoot, yes.io)).toBe(0);
    expect(yes.out).toEqual(['hbo-test GN 1:7: phrase "את הרקיע" occurs (match: either)']);
    const no = capture();
    expect(await runFind(['hbo-test', 'GN', '1', '7', 'הרקיע', 'את'], fixtureRoot, no.io)).toBe(1);
    expect(no.out).toEqual(['hbo-test GN 1:7: phrase "הרקיע את" does not occur (match: either)']);
  });

  it('exits 1 when the word or the verse is missing', async () => {
    const word = capture();
    expect(await runFind(['grc-test', 'MT', '20', '15', 'ἀγάπη'], fixtureRoot, word.io)).toBe(1);
    expect(word.out).toEqual(['grc-test MT 20:15: "ἀγάπη" not found (match: either)']);
    const verse = capture();
    expect(await runFind(['grc-test', 'MT', '20', '40', 'ἀγάπη'], fixtureRoot, verse.io)).toBe(1);
    expect(verse.err).toEqual(['grc-test MT 20:40: verse not in corpus']);
  });

  it('exits 2 with usage on bad arguments, and on corpus errors', async () => {
    const few = capture();
    expect(await runFind(['grc-test', 'MT', '20'], fixtureRoot, few.io)).toBe(2);
    expect(few.err[0]).toBe('expected an edition, book, chapter, verse and word');
    expect(few.err[1]).toMatch(/^usage: corpus:find/);
    const mode = capture();
    expect(await runFind(['grc-test', 'MT', '20', '15', 'x', '--match', 'fuzzy'], fixtureRoot, mode.io)).toBe(2);
    expect(mode.err[0]).toBe('--match must be one of surface, lemma, either');
    const missing = capture();
    expect(await runFind(['grc-test', 'MT', '20', '15', 'x', '--match'], fixtureRoot, missing.io)).toBe(2);
    const help = capture();
    expect(await runFind(['--help'], fixtureRoot, help.io)).toBe(2);
    expect(help.err).toHaveLength(1);
    expect(await runFind(['-h'], fixtureRoot, capture().io)).toBe(2);
    const unknown = capture();
    expect(await runFind(['grc-none', 'MT', '20', '15', 'x'], fixtureRoot, unknown.io)).toBe(2);
    expect(unknown.err[0]).toMatch(/^unknown edition: grc-none/);
  });

  it('rethrows unexpected errors', async () => {
    await expect(runFind(['grc-test', 'MT', '20', '15', 'x'], '\0bad', capture().io)).rejects.toThrow();
  });
});

describe('runLicences', () => {
  it('prints the attribution list', async () => {
    const { out, io } = capture();
    expect(await runLicences(fixtureRoot, io)).toBe(0);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/^grc-test: Greek test edition/);
    expect(out[0]?.endsWith('\n')).toBe(false);
  });

  it('exits 2 on an invalid SOURCE.json and rethrows unexpected errors', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lectio-cli-'));
    temps.push(root);
    await mkdir(join(root, 'bad'));
    await writeFile(join(root, 'bad', 'SOURCE.json'), '{');
    const { err, io } = capture();
    expect(await runLicences(root, io)).toBe(2);
    expect(err[0]).toMatch(/invalid JSON/);
    await expect(runLicences('\0bad', capture().io)).rejects.toThrow();
  });
});

describe('resolveCorpusRoot', () => {
  it('prefers LECTIO_CORPUS_ROOT', () => {
    expect(resolveCorpusRoot({ LECTIO_CORPUS_ROOT: 'x/corpus' }, '/work')).toBe(resolve('/work', 'x/corpus'));
    expect(resolveCorpusRoot({ LECTIO_CORPUS_ROOT: '/abs/corpus', INIT_CWD: '/repo' }, '/work')).toBe(
      resolve('/abs/corpus'),
    );
  });

  it('resolves a relative LECTIO_CORPUS_ROOT against INIT_CWD, where the user ran npm', () => {
    expect(resolveCorpusRoot({ LECTIO_CORPUS_ROOT: 'corpus', INIT_CWD: '/repo' }, '/repo/packages/corpus')).toBe(
      resolve('/repo', 'corpus'),
    );
  });

  it('finds the workspace root above INIT_CWD or cwd', () => {
    const packageDir = join(repoRoot, 'packages', 'corpus');
    expect(resolveCorpusRoot({ INIT_CWD: packageDir, LECTIO_CORPUS_ROOT: '' }, '/elsewhere')).toBe(
      join(resolve(repoRoot), 'corpus'),
    );
    expect(resolveCorpusRoot({}, join(packageDir, 'src'))).toBe(join(resolve(repoRoot), 'corpus'));
  });

  it('skips unparsable package.json files and fails above the file-system root', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lectio-root-'));
    temps.push(dir);
    await writeFile(join(dir, 'package.json'), '{');
    await mkdir(join(dir, 'inner'));
    await writeFile(join(dir, 'inner', 'package.json'), '{"name": "inner"}');
    expect(() => resolveCorpusRoot({ INIT_CWD: join(dir, 'inner') }, '/')).toThrow(/no workspace root above/);
    expect(() => resolveCorpusRoot({}, join(dir, 'inner'))).toThrow(`no workspace root above ${join(dir, 'inner')}`);
  });
});
