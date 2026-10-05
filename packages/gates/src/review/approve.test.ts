import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
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
  reviewTimestamp,
} from './approve.ts';
import type { ReviewFs, VerifierSummary } from './approve.ts';

const FIXTURE = fileURLToPath(new URL('fixtures/passages/MT.20.1-16.json', import.meta.url));
const ORIGINAL = readFileSync(FIXTURE, 'utf8');
const config = { reviewer: { ...DEFAULT_CONFIG.reviewer, githubHandles: ['nyabongo', 'Fr-Reviewer'] } };
const NOW = '2026-10-05T09:30:00.123Z';

/** An in-memory file system; paths keep their real location so Prettier finds the repo config. */
function memoryFs(initial: Record<string, string> = { [FIXTURE]: ORIGINAL }): ReviewFs & {
  files: Record<string, string>;
  writes: string[];
} {
  const files = { ...initial };
  const writes: string[] = [];
  return {
    files,
    writes,
    readFile(path) {
      const text = files[path];
      if (text === undefined) throw new Error(`ENOENT: ${path}`);
      return text;
    },
    writeFile(path, text) {
      files[path] = text;
      writes.push(path);
    },
  };
}

const parse = (text: string | undefined): Passage => JSON.parse(text ?? '') as Passage;

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
    expect(outcomes).toEqual([{ file: FIXTURE, changed: true }]);
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

  it('is idempotent: re-running changes nothing, even later or via another channel', async () => {
    const fs = memoryFs();
    await approveHuman([FIXTURE], { reviewer: 'nyabongo', via: 'label', now: NOW, config, fs });
    const once = fs.files[FIXTURE];
    const again = await approveHuman([FIXTURE], { reviewer: '@NYABONGO', via: 'cli', now: new Date(), config, fs });
    expect(again).toEqual([{ file: FIXTURE, changed: false }]);
    expect(fs.files[FIXTURE]).toBe(once);
    expect(fs.writes).toHaveLength(1);
  });

  it('adds a second reviewer, in the configured spelling', async () => {
    const fs = memoryFs();
    await approveHuman([FIXTURE], { reviewer: 'nyabongo', via: 'label', now: NOW, config, fs });
    await approveHuman([FIXTURE], { reviewer: 'fr-reviewer', via: 'comment', now: '2026-10-06T00:00:00Z', config, fs });
    expect(parse(fs.files[FIXTURE]).review).toEqual({
      status: 'approved',
      method: 'human',
      reviewers: ['nyabongo', 'Fr-Reviewer'],
      approvedVia: 'comment',
      lastReviewedAt: '2026-10-06T00:00:00Z',
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
    expect(fs.writes).toEqual([]);
  });

  it('writes nothing when any file fails', async () => {
    const other = FIXTURE.replace('MT.20.1-16', 'IS.55.6-9');
    const fs = memoryFs({ [FIXTURE]: ORIGINAL, [other]: ORIGINAL });
    await expect(
      approveHuman([FIXTURE, other], { reviewer: 'nyabongo', via: 'cli', now: NOW, config, fs }),
    ).rejects.toThrow(/IS\.55\.6-9\.json#\/key: must equal the file name key "IS\.55\.6-9"/);
    expect(fs.writes).toEqual([]);
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

describe('approveAuto', () => {
  it('writes an auto block with the verifier summary, idempotently', async () => {
    const fs = memoryFs();
    expect(await approveAuto([FIXTURE], summary, new Date(NOW), { fs })).toEqual([{ file: FIXTURE, changed: true }]);
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
    expect(await approveAuto([FIXTURE], reordered, '2026-12-01T00:00:00Z', { fs })).toEqual([
      { file: FIXTURE, changed: false },
    ]);
    expect(fs.writes).toHaveLength(1);
  });

  it('rewrites when the summary changes', async () => {
    const fs = memoryFs();
    await approveAuto([FIXTURE], summary, NOW, { fs });
    const next = { ...summary, sensitive: 0 };
    expect(await approveAuto([FIXTURE], next, NOW, { fs })).toEqual([{ file: FIXTURE, changed: true }]);
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

  it('reads and writes real files', async () => {
    dir = mkdtempSync(join(tmpdir(), 'lectio-review-'));
    mkdirSync(join(dir, 'passages'));
    const file = join(dir, 'passages', 'MT.20.1-16.json');
    copyFileSync(FIXTURE, file);
    await approveAuto([file], summary, NOW);
    expect(parse(readFileSync(file, 'utf8')).review.method).toBe('auto');
    expect(await approveAuto([file], summary, NOW)).toEqual([{ file, changed: false }]);
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
});
