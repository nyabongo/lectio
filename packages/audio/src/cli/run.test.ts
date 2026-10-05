import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { openRepo } from '@lectio/content';
import type { ContentRepo } from '@lectio/content';
import { AzureTtsProvider } from '@lectio/provider-azure-tts';
import { isS3ObjectStorage } from '@lectio/provider-s3';
import { FakeClock, FakeTtsProvider, FsObjectStorage, MemoryObjectStorage, ProviderError } from '@lectio/providers';
import type { ObjectStorage, TtsFormat, TtsRequest, TtsResult } from '@lectio/providers';
import type { Passage } from '@lectio/schema/passage';

import { MANIFEST_KEY, emptyManifest, parseManifest, readManifest } from '../render/manifest.ts';
import { planRender } from '../render/plan.ts';
import { DEFAULT_CONFIG, deepMerge } from '@lectio/config';
import type { LectioConfig } from '@lectio/config';

import {
  MeteredTtsProvider,
  USAGE,
  approvedSegments,
  autoTargets,
  defaultRetries,
  parseRenderArgs,
  reportPlan,
  resolveTargets,
  runRender,
  siteManifestOf,
  storageFor,
  summaryMarkdown,
  translationSegments,
  ttsFor,
} from './run.ts';

const FIXTURE_REPO = fileURLToPath(new URL('../script/fixtures/repo', import.meta.url));
const LOCALE_REPO = fileURLToPath(new URL('../locale/fixtures/repo', import.meta.url));

/** Makes `key` look missing from `storage`, as an object deleted from the bucket would. */
function hide(storage: MemoryObjectStorage, key: string): void {
  const { list, head, get } = {
    list: storage.list.bind(storage),
    head: storage.head.bind(storage),
    get: storage.get.bind(storage),
  };
  vi.spyOn(storage, 'list').mockImplementation(async (prefix) =>
    (await list(prefix)).filter((info) => info.key !== key),
  );
  vi.spyOn(storage, 'head').mockImplementation((k) => (k === key ? Promise.resolve(null) : head(k)));
  vi.spyOn(storage, 'get').mockImplementation((k) => (k === key ? Promise.resolve(null) : get(k)));
}

type TtsProviderLike = { readonly formats: readonly TtsFormat[]; synthesize(request: TtsRequest): Promise<TtsResult> };

/** Every secret the live providers need. */
const SECRETS = {
  AZURE_SPEECH_KEY: 'key',
  AZURE_SPEECH_REGION: 'westeurope',
  S3_BUCKET: 'lectio-audio',
  S3_ACCESS_KEY_ID: 'id',
  S3_SECRET_ACCESS_KEY: 'secret',
  R2_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
} as const;

/** A stand-in for the live voice: mp3 bytes, one per character, and the billed count it reports. */
class Mp3Tts {
  readonly formats: readonly TtsFormat[] = ['mp3'];
  readonly requests: TtsRequest[] = [];
  readonly #bill: (text: string) => number;
  constructor(bill: (text: string) => number = (text) => [...text].length) {
    this.#bill = bill;
  }
  async synthesize(request: TtsRequest): Promise<TtsResult> {
    this.requests.push(request);
    const characters = this.#bill(request.text);
    const audio = new Uint8Array([...request.text].length);
    return { audio, format: 'mp3', contentType: 'audio/mpeg', durationMs: audio.length * 10, characters };
  }
}

function capture(): { out: string[]; err: string[]; io: { out: (l: string) => void; err: (l: string) => void } } {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, io: { out: (line) => out.push(line), err: (line) => err.push(line) } };
}

describe('parseRenderArgs', () => {
  it('has defaults and reads every flag', () => {
    expect(parseRenderArgs([])).toEqual({
      provider: undefined,
      storage: undefined,
      dryRun: false,
      concurrency: 4,
      retries: undefined,
      auto: false,
      locales: [],
      siteManifest: undefined,
      summary: undefined,
    });
    expect(
      parseRenderArgs(['--auto', '--locale', 'sw', '--locale', 'fr', '--site-manifest', 'm.json', '--summary', 's.md']),
    ).toMatchObject({ auto: true, locales: ['sw', 'fr'], siteManifest: 'm.json', summary: 's.md' });
    expect(
      parseRenderArgs([
        '--',
        '--provider',
        'fake',
        '--storage',
        'memory',
        '--dry-run',
        '--concurrency',
        '8',
        '--retries',
        '0',
      ]),
    ).toMatchObject({ provider: 'fake', storage: 'memory', dryRun: true, concurrency: 8, retries: 0 });
  });

  it('rejects unknown, incomplete and out-of-range arguments', () => {
    expect(parseRenderArgs(['--force'])).toBe('unknown or incomplete argument "--force"');
    expect(parseRenderArgs(['--storage'])).toBe('unknown or incomplete argument "--storage"');
    expect(parseRenderArgs(['--concurrency', '0'])).toBe('--concurrency must be an integer of at least 1');
    expect(parseRenderArgs(['--retries', 'x'])).toBe('--retries must be an integer of at least 0');
    expect(parseRenderArgs(['--locale'])).toBe('unknown or incomplete argument "--locale"');
    expect(parseRenderArgs(['--auto', '--storage', 'memory'])).toBe(
      '--auto picks the provider and storage itself; drop --provider and --storage',
    );
    expect(parseRenderArgs(['--provider', 'fake', '--auto'])).toMatch(/^--auto picks/);
  });
});

describe('defaultRetries', () => {
  it('retries a live voice once, since its client retries too', () => {
    expect(defaultRetries('fake')).toBe(2);
    expect(defaultRetries('azure')).toBe(1);
  });
});

describe('ttsFor and storageFor', () => {
  const config = DEFAULT_CONFIG as LectioConfig;

  it('builds the fake provider and fs or memory storage', () => {
    expect(ttsFor('fake', config)).toBeInstanceOf(FakeTtsProvider);
    expect(ttsFor('polly', config)).toBe('unsupported --provider "polly" (fake or azure)');
    expect(storageFor('memory', '/x', config)).toBeInstanceOf(MemoryObjectStorage);
    expect(storageFor('fs:out', '/x', config)).toBeInstanceOf(FsObjectStorage);
    expect(storageFor('fs:', '/x', config)).toBe('unsupported --storage "fs:" (fs:<dir>, memory or s3)');
    expect(storageFor('s3:bucket', '/x', config)).toBe('unsupported --storage "s3:bucket" (fs:<dir>, memory or s3)');
  });

  it('composes Azure and S3 through createProviders only when their secrets are present', () => {
    expect(ttsFor('azure', config)).toBe(
      '--provider azure needs AZURE_SPEECH_KEY and AZURE_SPEECH_REGION in the environment',
    );
    expect(storageFor('s3', '/x', config, { S3_BUCKET: 'b' })).toBe(
      '--storage s3 needs S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY and S3_ENDPOINT or R2_ACCOUNT_ID ' +
        'in the environment',
    );
    expect(ttsFor('azure', config, SECRETS)).toBeInstanceOf(AzureTtsProvider);
    expect(isS3ObjectStorage(storageFor('s3', '/x', config, SECRETS) as ObjectStorage)).toBe(true);
  });
});

describe('autoTargets', () => {
  const config = (publicBaseUrl: string): LectioConfig =>
    deepMerge(DEFAULT_CONFIG, { tts: { storage: { publicBaseUrl } } }) as LectioConfig;

  it('goes live only with every secret and a public base URL', () => {
    expect(autoTargets(config('https://audio.example/'), SECRETS)).toEqual({
      provider: 'azure',
      storage: 's3',
      live: true,
      missing: [],
    });
    expect(autoTargets(config(''), { ...SECRETS, LECTIO_STORAGE_DIR: 'out' })).toEqual({
      provider: 'fake',
      storage: 'fs:out',
      live: false,
      missing: ['tts.storage.publicBaseUrl in the config'],
    });
    const none = autoTargets(config(''), {});
    expect(none).toMatchObject({ provider: 'fake', storage: 'fs:.audio-out', live: false });
    expect(none.missing).toHaveLength(3);
    expect(none.missing[0]).toBe('AZURE_SPEECH_KEY and AZURE_SPEECH_REGION');
  });
});

describe('MeteredTtsProvider', () => {
  const request = (text: string): TtsRequest => ({ text, voice: 'v', format: 'mp3' });

  it('meters what the provider bills and refuses a request that would pass the limit', async () => {
    const inner = new Mp3Tts((text) => [...text].length * 2);
    const metered = new MeteredTtsProvider(inner, 10);
    expect(metered.formats).toEqual(['mp3']);
    await metered.synthesize(request('abc'));
    expect(metered.billed).toBe(6);
    const error = await metered.synthesize(request('abcde')).catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).retryable).toBe(false);
    expect((error as ProviderError).message).toBe('monthly character budget: 6 billed, 5 more would pass the 10 left');
    await metered.synthesize(request('ab'));
    expect(metered.billed).toBe(10);
    expect(inner.requests).toHaveLength(2);
  });

  it('reserves requests in flight and releases them when they fail', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let fail = false;
    const inner = {
      formats: ['wav'] as const,
      async synthesize(r: TtsRequest): Promise<TtsResult> {
        await gate;
        if (fail) throw new Error('down');
        return {
          audio: new Uint8Array(1),
          format: 'wav',
          contentType: 'audio/wav',
          durationMs: 1,
          characters: r.text.length,
        };
      },
    };
    const metered = new MeteredTtsProvider(inner, 5);
    const first = metered.synthesize(request('abcd'));
    await expect(metered.synthesize(request('ab'))).rejects.toThrow('0 billed, 2 more would pass the 5 left');
    release();
    await first;
    fail = true;
    await expect(metered.synthesize(request('a'))).rejects.toThrow('down');
    expect(metered.billed).toBe(4);
    fail = false;
    await metered.synthesize(request('a'));
    expect(metered.billed).toBe(5);
  });
});

describe('translationSegments', () => {
  it('narrates approved translations and reports locales it cannot narrate', () => {
    const { err, io } = capture();
    const segments = translationSegments(openRepo(LOCALE_REPO), ['sw', 'xx'], io);
    expect(segments.length).toBeGreaterThan(0);
    expect(segments.every((segment) => segment.locale === 'sw')).toBe(true);
    expect(err.at(-1)).toBe('  skipped locale xx: No narration for locale "xx"');
  });

  it('lists translations that may not be narrated', () => {
    const repo = openRepo(LOCALE_REPO);
    const unapproved = {
      root: repo.root,
      passage: (key: string) => {
        const passage = repo.passage(key);
        return passage === null ? null : { ...passage, review: { ...passage.review, status: 'pending' } };
      },
    } as unknown as ContentRepo;
    const { err, io } = capture();
    expect(translationSegments(unapproved, ['sw'], io)).toEqual([]);
    expect(err.length).toBeGreaterThan(0);
    expect(err.every((line) => line.endsWith(': source-unapproved'))).toBe(true);
  });
});

describe('siteManifestOf', () => {
  it('drops stale keys unless they were rendered or adopted again', () => {
    const entry = {
      url: 'https://x/',
      bytes: 1,
      durationMs: null,
      voice: 'v',
      ttsVersion: 'fake-1',
      format: 'wav',
      createdAt: '2026-10-01T00:00:00Z',
      contentType: 'audio/wav',
      characters: 1,
    } as const;
    const manifest = { version: 1, entries: { a: entry, b: entry, c: entry, d: entry } };
    expect(Object.keys(siteManifestOf(manifest, ['a', 'b', 'c'], { rendered: ['b'], adopted: ['c'] }).entries)).toEqual(
      ['b', 'c', 'd'],
    );
    expect(Object.keys(siteManifestOf(manifest, ['a']).entries)).toEqual(['b', 'c', 'd']);
  });
});

describe('summaryMarkdown', () => {
  const plan = planRender([], emptyManifest(), { voices: {}, ttsVersion: 'fake-1', format: 'wav' });

  it('says plainly when nothing is published', () => {
    const auto = { provider: 'fake', storage: 'fs:.audio-out', live: false, missing: ['A', 'B'] };
    const text = summaryMarkdown({ ...auto, auto, published: false, segments: 0, plan });
    expect(text).toContain('**no audio is published**');
    expect(text).toContain('Live audio needs: A; B.');
    expect(text).toContain('- 0 segments, 0 files wanted, 0 up to date, 0 to render');
    expect(text).toContain('- site audio: none (all `audio` null)');
    expect(text.endsWith('\n')).toBe(true);
  });

  it('reports a live run, its result and why it stopped', () => {
    const result = { rendered: ['a'], adopted: [], failed: [], characters: 12, manifest: emptyManifest() };
    const text = summaryMarkdown({
      provider: 'azure',
      storage: 's3',
      published: true,
      result,
      problem: 'boom',
    });
    expect(text).toContain('Provider `azure`, storage `s3`.');
    expect(text).toContain('- rendered 1, adopted 0, failed 0 (12 characters billed)');
    expect(text).toContain('- site audio: manifest handed to the web build');
    expect(text).toContain('**Stopped early:** boom');
    expect(text).not.toContain('segments,');
  });
});

describe('approvedSegments', () => {
  it('skips missing passages and reports locales without narration strings', () => {
    const passage = { key: 'MT.20.1-16', locale: 'xx', review: { status: 'approved' } } as unknown as Passage;
    const repo = {
      passageKeys: () => ['GONE.1.1', 'MT.20.1-16'],
      passage: (key: string) => (key === 'MT.20.1-16' ? passage : null),
    } as unknown as ContentRepo;
    const { err, io } = capture();
    expect(approvedSegments(repo, io)).toEqual([]);
    expect(err).toEqual(['  skipped MT.20.1-16: No narration strings for locale "xx"']);
  });
});

describe('reportPlan', () => {
  it('prints counts, voiceless segments and orphans', () => {
    const swahili = {
      id: 'sw-1',
      kind: 'context',
      slot: 'gospel',
      title: 't',
      text: 'Habari.',
      locale: 'sw',
      passageKey: 'k',
    } as const;
    const plan = planRender([swahili], emptyManifest(), { voices: {}, ttsVersion: 'fake-1', format: 'wav' });
    const { out, err, io } = capture();
    const orphans = [
      { key: 'audio/en/a.wav', inManifest: false, inStorage: true },
      { key: 'audio/en/b.wav', inManifest: true, inStorage: false },
    ];
    reportPlan(1, plan, orphans, 5, io);
    expect(out).toEqual([
      'audio:render: 1 segments, 0 files wanted, 0 up to date, 0 to render (0 characters of 5 left this month)',
      '  2 orphaned file(s), not deleted:',
      '    audio/en/a.wav (storage)',
      '    audio/en/b.wav (manifest)',
    ]);
    expect(err).toEqual(['  no voice for sw: sw-1']);
  });
});

describe('resolveTargets', () => {
  const args = { dryRun: false, concurrency: 1, retries: 0 };
  const config = (tts: object): LectioConfig => deepMerge(DEFAULT_CONFIG, { tts }) as LectioConfig;

  it('defaults to the configured provider and storage, quietly', () => {
    const { err, io } = capture();
    const cfg = config({});
    expect(resolveTargets({ ...args, provider: undefined, storage: undefined }, cfg, {}, io)).toEqual({
      provider: 'fake',
      storage: 'fs:.audio-out',
    });
    expect(
      resolveTargets({ ...args, provider: undefined, storage: undefined }, cfg, { LECTIO_STORAGE_DIR: 'x' }, io),
    ).toMatchObject({ storage: 'fs:x' });
    const live = config({ provider: 'azure', storage: { provider: 's3' } });
    expect(resolveTargets({ ...args, provider: undefined, storage: undefined }, live, {}, io)).toEqual({
      provider: 'azure',
      storage: 's3',
    });
    expect(err).toEqual([]);
  });

  it('warns when a flag overrides the config', () => {
    const { err, io } = capture();
    const live = config({ provider: 'azure', storage: { provider: 's3' } });
    expect(resolveTargets({ ...args, provider: 'fake', storage: 'memory' }, live, {}, io)).toEqual({
      provider: 'fake',
      storage: 'memory',
    });
    expect(err).toEqual([
      '  warning: --provider fake overrides tts.provider azure',
      '  warning: --storage memory overrides tts.storage.provider s3',
    ]);
  });
});

describe('runRender', () => {
  let dir: string;
  let repo: string;
  let env: Record<string, string>;
  const clock = new FakeClock({ start: '2026-10-05T06:00:00.000Z' });

  const writeConfig = async (budget = 1_000_000, publicBaseUrl = ''): Promise<void> => {
    const config = { content: { root: repo }, tts: { monthlyCharBudget: budget, storage: { publicBaseUrl } } };
    await writeFile(join(dir, 'lectio.config.json'), JSON.stringify(config));
  };
  const run = (args: string[]): Promise<{ code: number; out: string[]; err: string[] }> => {
    const { out, err, io } = capture();
    return runRender(args, { cwd: dir, env, io, clock }).then((code) => ({ code, out, err }));
  };

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'lectio-audio-render-'));
    repo = join(dir, 'repo');
    await cp(FIXTURE_REPO, repo, { recursive: true });
    env = { LECTIO_CONFIG: join(dir, 'lectio.config.json') };
    await writeConfig();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('renders the approved notes, then nothing, then only the changed note', async () => {
    const first = await run(['--provider', 'fake', '--storage', 'fs:.audio-out']);
    expect(first.code).toBe(0);
    expect(first.out[0]).toMatch(
      /^audio:render: 3 segments, 3 files wanted, 0 up to date, 3 to render \(\d+ characters of 1000000 left this month\)$/,
    );
    expect(first.out.at(-1)).toMatch(/^audio:render: rendered 3, adopted 0, failed 0 \(\d+ characters billed\)$/);
    const storage = new FsObjectStorage(join(dir, '.audio-out'));
    const manifest = await readManifest(storage);
    const keys = Object.keys(manifest.entries);
    expect(keys).toHaveLength(3);
    expect(keys.every((key) => /^audio\/en\/[0-9a-f]{64}\.wav$/.test(key))).toBe(true);
    expect(Object.values(manifest.entries).every((e) => e.createdAt === '2026-10-05T06:00:00.000Z')).toBe(true);

    const second = await run(['--storage', 'fs:.audio-out']);
    expect(second.code).toBe(0);
    expect(second.out[0]).toContain('3 up to date, 0 to render');
    expect(second.out.at(-1)).toMatch(/^audio:render: rendered 0, adopted 0, failed 0 \(0 characters billed\)$/);

    const file = join(repo, 'passages', 'MT.20.1-16.json');
    const passage = JSON.parse(await readFile(file, 'utf8')) as Passage;
    const notes = passage.translationNotes.map((note) =>
      note.id === 'agathos' ? { ...note, summary: 'The landowner calls himself “good”.' } : note,
    );
    await writeFile(file, JSON.stringify({ ...passage, translationNotes: notes }));
    const third = await run(['--storage', 'fs:.audio-out']);
    expect(third.code).toBe(0);
    expect(third.out[0]).toContain('2 up to date, 1 to render');
    expect(third.out).toContain('  1 orphaned file(s), not deleted:');
    expect(third.out.at(-1)).toMatch(/^audio:render: rendered 1, adopted 0/);
    const after = await readManifest(storage);
    expect(Object.keys(after.entries)).toHaveLength(4);

    const dry = await run(['--storage', 'fs:.audio-out', '--dry-run']);
    expect(dry.out.filter((line) => line.endsWith('(manifest, storage)'))).toHaveLength(1);
  });

  it('renders again exactly the file that went missing from storage', async () => {
    expect((await run([])).code).toBe(0);
    const storage = new FsObjectStorage(join(dir, '.audio-out'));
    const [lost, ...kept] = Object.keys((await readManifest(storage)).entries) as [string, ...string[]];
    await rm(join(dir, '.audio-out', 'meta', `${lost}.json`));
    await rm(join(dir, '.audio-out', 'objects', `${lost}.body`));
    const result = await run([]);
    expect(result.code).toBe(0);
    expect(result.out[0]).toContain('2 up to date, 1 to render');
    expect(result.err).toEqual([`  missing from storage, rendering again: ${lost}`]);
    expect(result.out.at(-1)).toMatch(/^audio:render: rendered 1, adopted 0, failed 0/);
    expect(await storage.head(lost)).not.toBeNull();
    expect(kept).toHaveLength(2);
  });

  it('exits 2 when the configured live provider has no secrets', async () => {
    await writeFile(
      join(dir, 'lectio.config.json'),
      JSON.stringify({ content: { root: repo }, tts: { provider: 'azure' } }),
    );
    const result = await run([]);
    expect(result.code).toBe(2);
    expect(result.err[0]).toContain('--provider azure needs AZURE_SPEECH_KEY');
  });

  it('--auto without secrets renders the fake voice locally, publishes nothing and says so', async () => {
    await writeConfig(1_000_000, 'https://audio.example/');
    const result = await run(['--auto', '--site-manifest', 'site/manifest.json', '--summary', 'summary.md']);
    expect(result.code).toBe(0);
    expect(result.out[0]).toMatch(/^audio:render: --auto: fake voice into fs:\.audio-out, not published \(missing /);
    expect(result.out.at(-1)).toBe('audio:render: no site manifest: these files are not published');
    const manifest = await readManifest(new FsObjectStorage(join(dir, '.audio-out')));
    expect(Object.keys(manifest.entries)).toHaveLength(3);
    expect(Object.values(manifest.entries).every((entry) => !entry.url.startsWith('http'))).toBe(true);
    await expect(readFile(join(dir, 'site', 'manifest.json'))).rejects.toThrow();
    const summary = await readFile(join(dir, 'summary.md'), 'utf8');
    expect(summary).toContain('**no audio is published**');
    expect(summary).toContain('- rendered 3, adopted 0, failed 0');
  });

  it('--auto with every secret renders the live voice into live storage and hands over the manifest', async () => {
    await writeConfig(1_000_000, 'https://audio.example/');
    env = { ...env, ...SECRETS };
    const tts = new Mp3Tts();
    const storage = new MemoryObjectStorage();
    const { out, err, io } = capture();
    const code = await runRender(['--auto', '--site-manifest', 'site/manifest.json', '--summary', 'summary.md'], {
      cwd: dir,
      env,
      io,
      clock,
      live: { tts, storage: () => storage },
    });
    expect(err).toEqual([]);
    expect(code).toBe(0);
    expect(out[0]).toBe('audio:render: --auto: live voice (azure) into s3');
    expect(out).toContain('audio:render: site manifest written to site/manifest.json');
    const site = parseManifest(await readFile(join(dir, 'site', 'manifest.json'), 'utf8'));
    const entries = Object.entries(site.entries);
    expect(entries).toHaveLength(3);
    for (const [key, entry] of entries) {
      expect(key).toMatch(/^audio\/en\/[0-9a-f]{64}\.mp3$/);
      expect(entry).toMatchObject({ url: `https://audio.example/${key}`, ttsVersion: 'azure-1', format: 'mp3' });
    }
    expect(await storage.get(MANIFEST_KEY)).not.toBeNull();
    expect(tts.requests).toHaveLength(3);
    expect(await readFile(join(dir, 'summary.md'), 'utf8')).toContain('manifest handed to the web build');
  });

  it('stops a live run whose billed characters pass the budget', async () => {
    await writeConfig(1_000_000, 'https://audio.example/');
    env = { ...env, ...SECRETS };
    // The provider bills far more than the text's length: the meter refuses the third file.
    const tts = new Mp3Tts(() => 499_990);
    const code = await runRender(['--auto', '--concurrency', '1', '--site-manifest', 'm.json'], {
      cwd: dir,
      env,
      io: capture().io,
      clock,
      live: { tts, storage: new MemoryObjectStorage() },
    });
    expect(code).toBe(1);
    expect(tts.requests).toHaveLength(2);
    const site = parseManifest(await readFile(join(dir, 'm.json'), 'utf8'));
    expect(Object.keys(site.entries)).toHaveLength(2);
  });

  it('narrates the approved translations of each --locale in the same plan', async () => {
    await rm(repo, { recursive: true });
    await cp(LOCALE_REPO, repo, { recursive: true });
    const english = await run(['--storage', 'memory', '--dry-run']);
    const both = await run(['--storage', 'memory', '--dry-run', '--locale', 'sw']);
    const rendered = (lines: string[]): string[] => lines.filter((line) => line.startsWith('  would render'));
    expect(rendered(english.out).every((line) => line.includes('audio/en/'))).toBe(true);
    expect(rendered(both.out).filter((line) => line.includes('audio/sw/')).length).toBeGreaterThan(0);
    expect(rendered(both.out).length).toBeGreaterThan(rendered(english.out).length);
  });

  it('exits 1 with the reason in the summary when storage holds a broken manifest', async () => {
    const storage = new FsObjectStorage(join(dir, 'store'));
    await storage.put(MANIFEST_KEY, '{"version": 9, "entries": {}}', { contentType: 'application/json' });
    const result = await run(['--storage', 'fs:store', '--summary', 'summary.md']);
    expect(result.code).toBe(1);
    expect(result.err.at(-1)).toBe('audio:render: audio manifest: unsupported version 9');
    expect(await readFile(join(dir, 'summary.md'), 'utf8')).toContain(
      '**Stopped early:** audio manifest: unsupported version 9',
    );
  });

  it('lists what it would render on a dry run without writing anything', async () => {
    await writeConfig(1_000_000, 'https://cdn.example/');
    const result = await run(['--storage', 'fs:out', '--dry-run']);
    expect(result.code).toBe(0);
    expect(result.out.filter((line) => line.startsWith('  would render audio/en/'))).toHaveLength(3);
    expect(result.out.some((line) => line.includes('(MT.20.1-16/context)'))).toBe(true);
    const manifest = await readManifest(new FsObjectStorage(join(dir, 'out')));
    expect(manifest.entries).toEqual({});
  });

  it('falls back to the system clock when the context has none', async () => {
    // An empty manifest leaves the whole budget whatever the date, so the result does not depend on it.
    const { out, io } = capture();
    const code = await runRender(['--storage', 'memory', '--dry-run'], { cwd: dir, env, io });
    expect(code).toBe(0);
    expect(out.filter((line) => line.startsWith('  would render audio/en/'))).toHaveLength(3);
  });

  it('stops before rendering when the month budget is spent', async () => {
    await writeConfig(10);
    const result = await run(['--storage', 'memory', '--summary', 'summary.md']);
    expect(result.code).toBe(1);
    expect(result.err.at(-1)).toMatch(/^audio:render: \d+ characters exceed the 10 left this month$/);
    expect(result.out).toHaveLength(1);
    expect(await readFile(join(dir, 'summary.md'), 'utf8')).toMatch(
      /\*\*Stopped early:\*\* \d+ characters exceed the 10 left this month; nothing new was rendered, and the audio already recorded stays published/,
    );
  });

  /** A live run (the azure route with a stand-in voice) into `storage`. */
  const live = async (args: string[], tts: Mp3Tts | TtsProviderLike, storage: MemoryObjectStorage) => {
    env = { ...env, ...SECRETS };
    const { out, err, io } = capture();
    const code = await runRender(['--provider', 'azure', '--storage', 's3', ...args], {
      cwd: dir,
      env,
      io,
      clock,
      live: { tts, storage },
    });
    return { code, out, err };
  };

  it('writes the site manifest for a live voice in configured storage with a public base URL', async () => {
    await writeConfig(1_000_000, 'https://cdn.example/');
    const result = await live(['--site-manifest', 'site.json'], new Mp3Tts(), new MemoryObjectStorage());
    expect(result.code).toBe(0);
    const site = parseManifest(await readFile(join(dir, 'site.json'), 'utf8'));
    expect(Object.values(site.entries).every((entry) => entry.url.startsWith('https://cdn.example/audio/en/'))).toBe(
      true,
    );
  });

  it('never publishes the fake voice, nor sends it to live storage', async () => {
    await writeConfig(1_000_000, 'https://cdn.example/');
    const fs = await run(['--storage', 'fs:out', '--site-manifest', 'site.json']);
    expect(fs.code).toBe(0);
    expect(fs.out.at(-1)).toBe('audio:render: no site manifest: these files are not published');
    await expect(readFile(join(dir, 'site.json'))).rejects.toThrow();
    const s3 = await run(['--provider', 'fake', '--storage', 's3']);
    expect(s3.code).toBe(2);
    expect(s3.err.some((line) => line.startsWith('audio:render: the fake voice never goes to live storage'))).toBe(
      true,
    );
  });

  it('exits 1 and names the files that failed', async () => {
    const failing = {
      formats: ['mp3'] as const,
      synthesize: (): Promise<TtsResult> => Promise.reject(new ProviderError('invalid-request', 'no')),
    };
    const result = await live(['--retries', '0'], failing, new MemoryObjectStorage());
    expect(result.code).toBe(1);
    expect(result.err.filter((line) => line.startsWith('  failed audio/en/'))).toHaveLength(3);
  });

  it('drops an entry whose file went missing and could not be rendered again from the site manifest', async () => {
    await writeConfig(1_000_000, 'https://cdn.example/');
    const storage = new MemoryObjectStorage();
    expect((await live(['--site-manifest', 'first.json'], new Mp3Tts(), storage)).code).toBe(0);
    const before = parseManifest(await readFile(join(dir, 'first.json'), 'utf8'));
    const [lost, ...kept] = Object.keys(before.entries).sort() as [string, ...string[]];
    hide(storage, lost);
    const failing = {
      formats: ['mp3'] as const,
      synthesize: (): Promise<TtsResult> => Promise.reject(new ProviderError('rate-limited', 'throttled')),
    };
    const result = await live(['--retries', '0', '--site-manifest', 'site.json'], failing, storage);
    expect(result.code).toBe(1);
    expect(result.err).toContain(`  missing from storage, rendering again: ${lost}`);
    const site = parseManifest(await readFile(join(dir, 'site.json'), 'utf8'));
    expect(Object.keys(site.entries).sort()).toEqual(kept);
    // render() also drops it from the stored manifest, so the next run does not trust it either.
    expect(Object.keys((await readManifest(storage)).entries).sort()).toEqual(kept);
  });

  it('keeps the audio already recorded on the site when the budget stops the run', async () => {
    await writeConfig(1_000_000, 'https://cdn.example/');
    const storage = new MemoryObjectStorage();
    expect((await live(['--site-manifest', 'first.json'], new Mp3Tts(), storage)).code).toBe(0);
    const first = parseManifest(await readFile(join(dir, 'first.json'), 'utf8'));
    // One file goes missing, and the budget now leaves nothing to render it again with.
    const [lost, ...kept] = Object.keys(first.entries).sort() as [string, ...string[]];
    hide(storage, lost);
    const used = Object.values(first.entries).reduce((sum, entry) => sum + entry.characters, 0);
    await writeConfig(used, 'https://cdn.example/');
    const tts = new Mp3Tts();
    const result = await live(['--site-manifest', 'site.json', '--summary', 'summary.md'], tts, storage);
    expect(result.code).toBe(1);
    expect(tts.requests).toEqual([]);
    const site = parseManifest(await readFile(join(dir, 'site.json'), 'utf8'));
    expect(Object.keys(site.entries).sort()).toEqual(kept);
    const summary = await readFile(join(dir, 'summary.md'), 'utf8');
    expect(summary).toContain('**Stopped early:**');
    expect(summary).toContain('- site audio: manifest handed to the web build');
  });

  it('keeps the audio already recorded on the site when the run fails part-way', async () => {
    await writeConfig(1_000_000, 'https://cdn.example/');
    const storage = new MemoryObjectStorage();
    expect((await live(['--site-manifest', 'first.json'], new Mp3Tts(), storage)).code).toBe(0);
    // Listing the bucket fails after the manifest was read.
    vi.spyOn(storage, 'list').mockRejectedValue(new Error('r2 list timed out'));
    const result = await live(['--site-manifest', 'site.json', '--summary', 'summary.md'], new Mp3Tts(), storage);
    expect(result.code).toBe(1);
    expect(result.err).toContain('audio:render: r2 list timed out');
    const site = parseManifest(await readFile(join(dir, 'site.json'), 'utf8'));
    expect(site.entries).toEqual(parseManifest(await readFile(join(dir, 'first.json'), 'utf8')).entries);
    expect(await readFile(join(dir, 'summary.md'), 'utf8')).toContain('**Stopped early:** r2 list timed out');
  });

  it('writes the site manifest before rendering, so a killed step still leaves the recorded audio', async () => {
    await writeConfig(1_000_000, 'https://cdn.example/');
    const storage = new MemoryObjectStorage();
    expect((await live(['--site-manifest', 'first.json'], new Mp3Tts(), storage)).code).toBe(0);
    const recorded = parseManifest(await readFile(join(dir, 'first.json'), 'utf8')).entries;
    const passage = JSON.parse(await readFile(join(repo, 'passages', 'MT.20.1-16.json'), 'utf8')) as Passage;
    await writeFile(
      join(repo, 'passages', 'MT.20.1-16.json'),
      JSON.stringify({ ...passage, summary: passage.summary, context: { ...passage.context, title: 'A new title' } }),
    );
    const seen: unknown[] = [];
    const tts = new Mp3Tts();
    const synthesize = tts.synthesize.bind(tts);
    tts.synthesize = async (request) => {
      seen.push(parseManifest(await readFile(join(dir, 'site.json'), 'utf8')).entries);
      return synthesize(request);
    };
    expect((await live(['--site-manifest', 'site.json'], tts, storage)).code).toBe(0);
    expect(seen).toEqual([recorded]);
  });

  it('writes no site manifest when the stored one cannot be read', async () => {
    await writeConfig(1_000_000, 'https://cdn.example/');
    const storage = new MemoryObjectStorage();
    await storage.put(MANIFEST_KEY, '{"version": 9, "entries": {}}', { contentType: 'application/json' });
    const result = await live(['--site-manifest', 'site.json'], new Mp3Tts(), storage);
    expect(result.code).toBe(1);
    expect(result.err.at(-1)).toBe('audio:render: no site manifest: the stored manifest could not be read');
    await expect(readFile(join(dir, 'site.json'))).rejects.toThrow();
  });

  it('writes no site manifest on a dry run', async () => {
    await writeConfig(1_000_000, 'https://cdn.example/');
    const result = await live(['--dry-run', '--site-manifest', 'site.json'], new Mp3Tts(), new MemoryObjectStorage());
    expect(result.code).toBe(0);
    await expect(readFile(join(dir, 'site.json'))).rejects.toThrow();
  });

  it('rejects bad usage with exit code 2', async () => {
    for (const args of [['--nope'], ['--provider', 'azure'], ['--storage', 's3:x'], ['--storage', 's3']]) {
      const result = await run(args);
      expect(result.code).toBe(2);
      expect(result.err.at(-1)).toContain(USAGE);
    }
  });
});
