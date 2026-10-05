import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ContentRepo } from '@lectio/content';
import { FakeClock, FakeTtsProvider, FsObjectStorage, MemoryObjectStorage } from '@lectio/providers';
import type { Passage } from '@lectio/schema/passage';

import { emptyManifest, readManifest } from '../render/manifest.ts';
import { planRender } from '../render/plan.ts';
import { DEFAULT_CONFIG, deepMerge } from '@lectio/config';
import type { LectioConfig } from '@lectio/config';

import {
  USAGE,
  approvedSegments,
  parseRenderArgs,
  reportPlan,
  resolveTargets,
  runRender,
  storageFor,
  ttsFor,
} from './run.ts';

const FIXTURE_REPO = fileURLToPath(new URL('../script/fixtures/repo', import.meta.url));

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
      retries: 2,
    });
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
    ).toEqual({ provider: 'fake', storage: 'memory', dryRun: true, concurrency: 8, retries: 0 });
  });

  it('rejects unknown, incomplete and out-of-range arguments', () => {
    expect(parseRenderArgs(['--force'])).toBe('unknown or incomplete argument "--force"');
    expect(parseRenderArgs(['--storage'])).toBe('unknown or incomplete argument "--storage"');
    expect(parseRenderArgs(['--concurrency', '0'])).toBe('--concurrency must be an integer of at least 1');
    expect(parseRenderArgs(['--retries', 'x'])).toBe('--retries must be an integer of at least 0');
  });
});

describe('ttsFor and storageFor', () => {
  it('builds the fake provider and fs or memory storage', () => {
    expect(ttsFor('fake')).toBeInstanceOf(FakeTtsProvider);
    expect(ttsFor('azure')).toBe('unsupported --provider "azure" (fake only)');
    expect(storageFor('memory', '/x')).toBeInstanceOf(MemoryObjectStorage);
    expect(storageFor('fs:out', '/x')).toBeInstanceOf(FsObjectStorage);
    expect(storageFor('fs:', '/x')).toBe('unsupported --storage "fs:" (fs:<dir> or memory)');
    expect(storageFor('s3:bucket', '/x')).toBe('unsupported --storage "s3:bucket" (fs:<dir> or memory)');
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

  it('exits 2 when the configured provider is not available yet', async () => {
    await writeFile(
      join(dir, 'lectio.config.json'),
      JSON.stringify({ content: { root: repo }, tts: { provider: 'azure' } }),
    );
    const result = await run([]);
    expect(result.code).toBe(2);
    expect(result.err[0]).toContain('unsupported --provider "azure"');
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

  it('stops before rendering when the month budget is spent', async () => {
    await writeConfig(10);
    const result = await run(['--storage', 'memory']);
    expect(result.code).toBe(1);
    expect(result.err.at(-1)).toMatch(/^audio:render: \d+ characters exceed the 10 left this month$/);
    expect(result.out).toHaveLength(1);
  });

  it('exits 1 and names the files that failed', async () => {
    // A file where the objects directory should be makes every write fail.
    await mkdir(join(dir, 'store'));
    await writeFile(join(dir, 'store', 'objects'), '');
    const result = await run(['--storage', 'fs:store', '--retries', '0']);
    expect(result.code).toBe(1);
    expect(result.err.filter((line) => line.startsWith('  failed audio/en/'))).toHaveLength(3);
  });

  it('rejects bad usage with exit code 2', async () => {
    for (const args of [['--nope'], ['--provider', 'azure'], ['--storage', 's3:x']]) {
      const result = await run(args);
      expect(result.code).toBe(2);
      expect(result.err.at(-1)).toContain(USAGE);
    }
  });
});
