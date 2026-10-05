import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { format, resolveConfig } from 'prettier';
import { afterEach, describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG } from '@lectio/config';
import { validatePassage } from '@lectio/schema/passage';
import type { Passage } from '@lectio/schema/passage';

import {
  ReviewError,
  approveAuto,
  approveHuman,
  checkVerifierSummary,
  configuredHandle,
  nodeReviewFs,
  passageContentHash,
  reviewTimestamp,
  tempPathFor,
} from './approve.ts';
import type { ReviewFs, VerifierSummary } from './approve.ts';

const FIXTURE = fileURLToPath(new URL('fixtures/passages/MT.20.1-16.json', import.meta.url));
const OTHER = FIXTURE.replace('MT.20.1-16', 'IS.55.6-9');
const ORIGINAL = readFileSync(FIXTURE, 'utf8');
const OTHER_TEXT = ORIGINAL.replace('"key": "MT.20.1-16"', '"key": "IS.55.6-9"');
const config = { reviewer: { ...DEFAULT_CONFIG.reviewer, githubHandles: ['nyabongo', 'Fr-Reviewer'] } };
const NOW = '2026-10-05T09:30:00.123Z';
const LATER = '2026-10-06T00:00:00Z';

interface MemoryFs extends ReviewFs {
  readonly files: Record<string, string>;
  /** Targets replaced by a rename, in order. */
  readonly commits: string[];
}

/**
 * An in-memory file system; paths keep their real location so Prettier finds the repo config.
 * `fail` names an operation and path that throws.
 */
function memoryFs(
  initial: Record<string, string> = { [FIXTURE]: ORIGINAL },
  fail: { op: 'write' | 'rename' | 'remove'; path: string; times?: number } | null = null,
): MemoryFs {
  const files: Record<string, string> = { ...initial };
  const commits: string[] = [];
  let failures = fail?.times ?? Infinity;
  const check = (op: 'write' | 'rename' | 'remove', path: string): void => {
    if (fail !== null && fail.op === op && fail.path === path && failures > 0) {
      failures -= 1;
      throw new Error(`${op} failed: ${path}`);
    }
  };
  return {
    files,
    commits,
    readFile(path) {
      const text = files[path];
      if (text === undefined) throw new Error(`ENOENT: ${path}`);
      return text;
    },
    writeFile(path, text) {
      check('write', path);
      files[path] = text;
    },
    rename(from, to) {
      check('rename', to);
      const text = files[from];
      if (text === undefined) throw new Error(`ENOENT: ${from}`);
      files[to] = text;
      delete files[from];
      commits.push(to);
    },
    remove(path) {
      check('remove', path);
      delete files[path];
    },
  };
}

const parse = (text: string | undefined): Passage => JSON.parse(text ?? '') as Passage;
const hash = passageContentHash(parse(ORIGINAL));

const summary: VerifierSummary = {
  confirmer: { model: 'claude-x', minSupport: 0.95 },
  refuter: { model: 'gpt-y', minSupport: 0.92 },
  minSupport: 0.92,
  refutations: 0,
  sensitive: 1,
};

describe('approveHuman', () => {
  it('writes a schema-valid approved block, formatted like the repo, touching only the review block', async () => {
    const fs = memoryFs();
    const outcomes = await approveHuman([FIXTURE], { reviewer: 'nyabongo', via: 'cli', now: NOW, config, fs });
    expect(outcomes).toEqual([{ file: FIXTURE, changed: true, contentHash: hash }]);
    expect(Object.keys(fs.files)).toEqual([FIXTURE]);
    const text = fs.files[FIXTURE] ?? '';
    const passage = parse(text);
    expect(validatePassage(passage)).toBe(true);
    expect(passage.review).toEqual({
      status: 'approved',
      method: 'human',
      reviewers: ['nyabongo'],
      approvedVia: 'cli',
      lastReviewedAt: '2026-10-05T09:30:00Z',
    });
    const prettierConfig = await resolveConfig(FIXTURE);
    expect(await format(text, { ...prettierConfig, filepath: FIXTURE })).toBe(text);
    const before = ORIGINAL.split('\n');
    const after = text.split('\n');
    const changed = after.filter((line, index) => line !== before[index]);
    expect(changed).toEqual([
      '    "status": "approved",',
      '    "method": "human",',
      '    "reviewers": ["nyabongo"],',
      '    "approvedVia": "cli",',
      '    "lastReviewedAt": "2026-10-05T09:30:00Z"',
      '  },',
      '  "schemaVersion": 1',
      '}',
      '',
    ]);
  });

  it('a repeat of the same approval event (handle, channel, time) changes nothing', async () => {
    const fs = memoryFs();
    await approveHuman([FIXTURE], { reviewer: 'nyabongo', via: 'label', now: NOW, config, fs });
    const once = fs.files[FIXTURE];
    const again = await approveHuman([FIXTURE], { reviewer: '@NYABONGO', via: 'label', now: NOW, config, fs });
    expect(again).toEqual([{ file: FIXTURE, changed: false, contentHash: hash }]);
    expect(fs.files[FIXTURE]).toBe(once);
    expect(fs.commits).toEqual([FIXTURE]);
  });

  it('a new approval event (later, or another channel) refreshes lastReviewedAt and approvedVia', async () => {
    const fs = memoryFs();
    await approveHuman([FIXTURE], { reviewer: 'nyabongo', via: 'label', now: NOW, config, fs });
    expect(await approveHuman([FIXTURE], { reviewer: 'nyabongo', via: 'label', now: LATER, config, fs })).toEqual([
      { file: FIXTURE, changed: true, contentHash: hash },
    ]);
    expect(parse(fs.files[FIXTURE]).review.lastReviewedAt).toBe(LATER);
    await approveHuman([FIXTURE], { reviewer: 'nyabongo', via: 'comment', now: LATER, config, fs });
    expect(parse(fs.files[FIXTURE]).review).toEqual({
      status: 'approved',
      method: 'human',
      reviewers: ['nyabongo'],
      approvedVia: 'comment',
      lastReviewedAt: LATER,
    });
    expect(fs.commits).toHaveLength(3);
  });

  it('re-approving edited content (the L-031 fixup case) writes a fresh block and reports the new hash', async () => {
    const fs = memoryFs();
    await approveHuman([FIXTURE], { reviewer: 'nyabongo', via: 'label', now: NOW, config, fs });
    const edited = (fs.files[FIXTURE] ?? '').replace('Labourers in the vineyard', 'The labourers in the vineyard');
    fs.files[FIXTURE] = edited;
    const [outcome] = await approveHuman([FIXTURE], { reviewer: 'nyabongo', via: 'label', now: LATER, config, fs });
    expect(outcome?.changed).toBe(true);
    expect(outcome?.contentHash).not.toBe(hash);
    expect(outcome?.contentHash).toBe(passageContentHash(parse(edited)));
    expect(parse(fs.files[FIXTURE]).review.lastReviewedAt).toBe(LATER);
  });

  it('adds a second reviewer, in the configured spelling', async () => {
    const fs = memoryFs();
    await approveHuman([FIXTURE], { reviewer: 'nyabongo', via: 'label', now: NOW, config, fs });
    await approveHuman([FIXTURE], { reviewer: 'fr-reviewer', via: 'comment', now: LATER, config, fs });
    expect(parse(fs.files[FIXTURE]).review).toEqual({
      status: 'approved',
      method: 'human',
      reviewers: ['nyabongo', 'Fr-Reviewer'],
      approvedVia: 'comment',
      lastReviewedAt: LATER,
    });
  });

  it('replaces an auto approval with the human one', async () => {
    const fs = memoryFs();
    await approveAuto([FIXTURE], summary, NOW, { fs });
    await approveHuman([FIXTURE], { reviewer: 'nyabongo', via: 'label', now: NOW, config, fs });
    expect(parse(fs.files[FIXTURE]).review).toEqual({
      status: 'approved',
      method: 'human',
      reviewers: ['nyabongo'],
      approvedVia: 'label',
      lastReviewedAt: '2026-10-05T09:30:00Z',
    });
  });

  it('rejects a handle that is not a configured reviewer and writes nothing', async () => {
    const fs = memoryFs();
    await expect(approveHuman([FIXTURE], { reviewer: 'stranger', via: 'cli', now: NOW, config, fs })).rejects.toThrow(
      new ReviewError('"stranger" is not a configured reviewer (config.reviewer.githubHandles: nyabongo, Fr-Reviewer)'),
    );
    expect(fs.files).toEqual({ [FIXTURE]: ORIGINAL });
  });

  it('writes nothing when any file fails validation', async () => {
    const fs = memoryFs({ [FIXTURE]: ORIGINAL, [OTHER]: ORIGINAL });
    await expect(
      approveHuman([FIXTURE, OTHER], { reviewer: 'nyabongo', via: 'cli', now: NOW, config, fs }),
    ).rejects.toThrow(/IS\.55\.6-9\.json#\/key: must equal the file name key "IS\.55\.6-9"/);
    expect(fs.files).toEqual({ [FIXTURE]: ORIGINAL, [OTHER]: ORIGINAL });
  });

  it.each([
    [['README.md'], /README\.md: not a passage file/],
    [[FIXTURE.replace('MT.20.1-16', 'MK.1.1')], /MK\.1\.1\.json: cannot read file \(ENOENT/],
    [[], /no files to approve/],
  ])('refuses %j', async (files, message) => {
    await expect(
      approveHuman(files, { reviewer: 'nyabongo', via: 'cli', now: NOW, config, fs: memoryFs() }),
    ).rejects.toThrow(message);
  });

  it('refuses a passage file that does not validate', async () => {
    const fs = memoryFs({ [FIXTURE]: '{"key":"MT.20.1-16"}' });
    await expect(
      approveHuman([FIXTURE], { reviewer: 'nyabongo', via: 'cli', now: NOW, config, fs }),
    ).rejects.toBeInstanceOf(ReviewError);
  });

  it('refuses a result that would not validate', async () => {
    const via = 'auto' as 'cli';
    await expect(
      approveHuman([FIXTURE], { reviewer: 'nyabongo', via, now: NOW, config, fs: memoryFs() }),
    ).rejects.toThrow(/approvedVia/);
  });
});

describe('atomic multi-file writes', () => {
  const both = { [FIXTURE]: ORIGINAL, [OTHER]: OTHER_TEXT };
  const approve = (fs: ReviewFs) =>
    approveHuman([FIXTURE, OTHER], { reviewer: 'nyabongo', via: 'cli', now: NOW, config, fs });

  it('writes both files through temporary files', async () => {
    const fs = memoryFs(both);
    expect((await approve(fs)).map((outcome) => outcome.changed)).toEqual([true, true]);
    expect(fs.commits).toEqual([FIXTURE, OTHER]);
    expect(Object.keys(fs.files).sort()).toEqual([OTHER, FIXTURE].sort());
  });

  it('leaves every file untouched when writing a temporary file fails', async () => {
    const fs = memoryFs(both, { op: 'write', path: tempPathFor(OTHER) });
    await expect(approve(fs)).rejects.toThrow(`write failed: ${tempPathFor(OTHER)}`);
    expect(fs.files).toEqual(both);
    expect(fs.commits).toEqual([]);
  });

  it('restores the files already replaced when a later rename fails', async () => {
    const fs = memoryFs(both, { op: 'rename', path: OTHER });
    await expect(approve(fs)).rejects.toThrow(`rename failed: ${OTHER}`);
    expect(fs.files).toEqual(both);
  });

  it('keeps going when cleanup itself fails, and rethrows the original error', async () => {
    // The first rename succeeds, the second fails; restoring the first then fails too (rename of
    // FIXTURE throws once more), and removing the leftover temp file of OTHER fails.
    let renames = 0;
    const base = memoryFs(both);
    const fs: ReviewFs = {
      ...base,
      rename(from, to) {
        renames += 1;
        if (renames >= 2) throw new Error(`rename ${String(renames)} failed`);
        base.rename(from, to);
      },
      remove() {
        throw new Error('remove failed');
      },
    };
    await expect(approve(fs)).rejects.toThrow('rename 2 failed');
    expect(renames).toBe(3);
  });
});

describe('approveAuto', () => {
  it('writes an auto block with the verifier summary; the same summary at the same time changes nothing', async () => {
    const fs = memoryFs();
    expect(await approveAuto([FIXTURE], summary, new Date(NOW), { fs })).toEqual([
      { file: FIXTURE, changed: true, contentHash: hash },
    ]);
    const passage = parse(fs.files[FIXTURE]);
    expect(validatePassage(passage)).toBe(true);
    expect(passage.review).toEqual({
      status: 'approved',
      method: 'auto',
      reviewers: [],
      approvedVia: 'auto',
      lastReviewedAt: '2026-10-05T09:30:00Z',
      verifierSummary: summary,
    });
    const reordered = {
      sensitive: 1,
      refutations: 0,
      minSupport: 0.92,
      refuter: summary.refuter,
      confirmer: summary.confirmer,
    };
    expect(await approveAuto([FIXTURE], reordered, NOW, { fs })).toEqual([
      { file: FIXTURE, changed: false, contentHash: hash },
    ]);
    expect(fs.commits).toHaveLength(1);
  });

  it('rewrites for a new decision time or a changed summary', async () => {
    const fs = memoryFs();
    await approveAuto([FIXTURE], summary, NOW, { fs });
    expect((await approveAuto([FIXTURE], summary, LATER, { fs }))[0]?.changed).toBe(true);
    expect(parse(fs.files[FIXTURE]).review.lastReviewedAt).toBe(LATER);
    const next = { ...summary, sensitive: 0 };
    expect((await approveAuto([FIXTURE], next, LATER, { fs }))[0]?.changed).toBe(true);
    expect(parse(fs.files[FIXTURE]).review.verifierSummary).toEqual(next);
  });

  it('rejects a summary whose minSupport is not the lower verifier score', async () => {
    await expect(approveAuto([FIXTURE], { ...summary, minSupport: 0.95 }, NOW, { fs: memoryFs() })).rejects.toThrow(
      'verifierSummary.minSupport must be min(confirmer, refuter) = 0.92, got 0.95',
    );
  });
});

describe('defaults: Node fs and Prettier', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  });

  it('reads and writes real files, leaving no temporary file behind', async () => {
    dir = mkdtempSync(join(tmpdir(), 'lectio-review-'));
    mkdirSync(join(dir, 'passages'));
    const file = join(dir, 'passages', 'MT.20.1-16.json');
    copyFileSync(FIXTURE, file);
    await approveAuto([file], summary, NOW);
    expect(parse(readFileSync(file, 'utf8')).review.method).toBe('auto');
    expect(await approveAuto([file], summary, NOW)).toEqual([{ file, changed: false, contentHash: hash }]);
    expect(readdirSync(join(dir, 'passages'))).toEqual(['MT.20.1-16.json']);
    nodeReviewFs.remove(join(dir, 'missing.json'));
  });
});

describe('helpers', () => {
  it('reviewTimestamp drops milliseconds and rejects invalid times', () => {
    expect(reviewTimestamp(new Date('2026-10-05T09:30:00Z'))).toBe('2026-10-05T09:30:00Z');
    expect(() => reviewTimestamp('yesterday')).toThrow('invalid review time: yesterday');
  });

  it('configuredHandle rejects an empty handle and reports an empty list', () => {
    expect(() => configuredHandle('@', config)).toThrow(ReviewError);
    expect(() => configuredHandle('x', { reviewer: { ...config.reviewer, githubHandles: [] } })).toThrow(
      'config.reviewer.githubHandles: none',
    );
  });

  it('checkVerifierSummary accepts the documented relation', () => {
    expect(() => {
      checkVerifierSummary(summary);
    }).not.toThrow();
  });

  it('passageContentHash ignores the review block and key order', () => {
    const passage = parse(ORIGINAL);
    const reordered = Object.fromEntries(Object.entries(passage).reverse()) as Passage;
    expect(passageContentHash({ ...reordered, review: { status: 'pending', reviewers: ['x'] } })).toBe(hash);
    expect(passageContentHash({ ...passage, summary: 'Different.' })).not.toBe(hash);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('translations (L-112)', () => {
  const SW = FIXTURE.replace('/passages/', '/passages/i18n/sw/');
  const SW_TEXT = readFileSync(
    new URL('../../../schema/src/translated-passage/fixtures/valid/pending.json', import.meta.url),
    'utf8',
  );

  it('records a human approval on a translation file, under the human-only rules', async () => {
    const fs = memoryFs({ [SW]: SW_TEXT });
    const [outcome] = await approveHuman([SW], { reviewer: '@fr-reviewer', via: 'comment', now: NOW, config, fs });
    expect(outcome?.changed).toBe(true);
    const written = JSON.parse(fs.files[SW] ?? '') as { review: unknown };
    expect(written.review).toEqual({
      status: 'approved',
      method: 'human',
      reviewers: ['Fr-Reviewer'],
      approvedVia: 'comment',
      lastReviewedAt: '2026-10-05T09:30:00Z',
    });
    const again = await approveHuman([SW], { reviewer: 'fr-reviewer', via: 'comment', now: NOW, config, fs });
    expect(again[0]?.changed).toBe(false);
    await expect(approveHuman([SW], { reviewer: 'someone', via: 'cli', now: NOW, config, fs })).rejects.toThrow(
      ReviewError,
    );
  });

  it('never approves a translation automatically, and writes nothing', async () => {
    const fs = memoryFs({ [SW]: SW_TEXT, [FIXTURE]: ORIGINAL });
    await expect(approveAuto([FIXTURE, SW], summary, NOW, { fs })).rejects.toThrow(
      /translations are approved by a person only/,
    );
    expect(fs.files[SW]).toBe(SW_TEXT);
    expect(fs.files[FIXTURE]).toBe(ORIGINAL);
  });

  it('refuses an invalid or misplaced translation', async () => {
    const options = { reviewer: 'nyabongo', via: 'cli' as const, now: NOW, config };
    await expect(approveHuman([SW], { ...options, fs: memoryFs({ [SW]: '{}' }) })).rejects.toThrow(ReviewError);
    const PT = SW.replace('/sw/', '/pt-BR/');
    await expect(approveHuman([PT], { ...options, fs: memoryFs({ [PT]: SW_TEXT }) })).rejects.toThrow(
      /must equal the directory locale "pt-BR"/,
    );
    await expect(approveHuman([SW], { ...options, fs: memoryFs({}) })).rejects.toThrow(/cannot read file/);
  });
});
