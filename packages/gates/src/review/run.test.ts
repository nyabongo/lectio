import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG } from '@lectio/config';

import type { FormatJson, ReviewFs } from './approve.ts';
import { APPROVE_USAGE, runApprove } from './run.ts';
import type { ApproveCliOptions } from './run.ts';

const FIXTURE = fileURLToPath(new URL('fixtures/passages/MT.20.1-16.json', import.meta.url));
const cwd = dirname(dirname(FIXTURE));

function setup(overrides: Partial<ApproveCliOptions> = {}) {
  const files: Record<string, string> = { [FIXTURE]: readFileSync(FIXTURE, 'utf8') };
  const logs: string[] = [];
  const errors: string[] = [];
  const fs: ReviewFs = {
    readFile: (path) => files[path] ?? '',
    writeFile: (path, text) => {
      files[path] = text;
    },
    rename: (from, to) => {
      files[to] = files[from] ?? '';
      delete files[from];
    },
    remove: (path) => {
      delete files[path];
    },
  };
  const format: FormatJson = (value) => Promise.resolve(`${JSON.stringify(value, null, 2)}\n`);
  const options: ApproveCliOptions = {
    cwd,
    env: {},
    now: () => new Date('2026-10-05T10:00:00Z'),
    log: (line) => logs.push(line),
    error: (line) => errors.push(line),
    config: DEFAULT_CONFIG,
    fs,
    format,
    ...overrides,
  };
  return { files, logs, errors, options };
}

describe('review:approve', () => {
  it('approves files relative to INIT_CWD with approvedVia cli, then reports them unchanged', async () => {
    const { files, logs, errors, options } = setup();
    const args = ['--', 'passages/MT.20.1-16.json', '--reviewer', 'nyabongo'];
    expect(await runApprove(args, options)).toBe(0);
    expect(errors).toEqual([]);
    expect(logs).toEqual(['approved passages/MT.20.1-16.json']);
    expect(JSON.parse(files[FIXTURE] ?? '').review).toEqual({
      status: 'approved',
      method: 'human',
      reviewers: ['nyabongo'],
      approvedVia: 'cli',
      lastReviewedAt: '2026-10-05T10:00:00Z',
    });
    expect(await runApprove(['--reviewer=nyabongo', 'passages/MT.20.1-16.json'], options)).toBe(0);
    expect(logs.at(-1)).toBe('unchanged passages/MT.20.1-16.json');
  });

  it('a later run is a new approval and refreshes lastReviewedAt', async () => {
    const { files, logs, options } = setup();
    await runApprove(['passages/MT.20.1-16.json', '--reviewer', 'nyabongo'], options);
    const later = { ...options, now: () => new Date('2026-10-07T08:00:00Z') };
    expect(await runApprove(['passages/MT.20.1-16.json', '--reviewer', 'nyabongo'], later)).toBe(0);
    expect(logs).toEqual(['approved passages/MT.20.1-16.json', 'approved passages/MT.20.1-16.json']);
    expect(JSON.parse(files[FIXTURE] ?? '').review.lastReviewedAt).toBe('2026-10-07T08:00:00Z');
  });

  it('approves a file named twice once, keeping the first spelling', async () => {
    const { files, logs, errors, options } = setup();
    const args = ['passages/MT.20.1-16.json', './passages/MT.20.1-16.json', '--reviewer', 'nyabongo'];
    expect(await runApprove(args, options)).toBe(0);
    expect(errors).toEqual([]);
    expect(logs).toEqual(['approved passages/MT.20.1-16.json']);
    expect(JSON.parse(files[FIXTURE] ?? '').review.reviewers).toEqual(['nyabongo']);
  });

  it('exits 1 for an unknown handle', async () => {
    const { logs, errors, options } = setup();
    expect(await runApprove(['passages/MT.20.1-16.json', '--reviewer', 'stranger'], options)).toBe(1);
    expect(logs).toEqual([]);
    expect(errors[0]).toMatch(/^review:approve: "stranger" is not a configured reviewer/);
  });

  it.each([[['passages/MT.20.1-16.json']], [['--reviewer', 'nyabongo']], [['--nope']]])(
    'exits 2 with usage for %j',
    async (args) => {
      const { errors, options } = setup();
      expect(await runApprove(args, options)).toBe(2);
      expect(errors.at(-1)).toBe(APPROVE_USAGE);
    },
  );

  it('prints usage for --help', async () => {
    const { logs, options } = setup();
    expect(await runApprove(['-h'], options)).toBe(0);
    expect(logs).toEqual([APPROVE_USAGE]);
  });

  it('loads the config from the working directory and uses the default writer', async () => {
    const { errors, options } = setup({ config: undefined, fs: undefined, format: undefined });
    // A missing file is refused before anything would be written.
    expect(await runApprove([join('passages', 'MK.1.1.json'), '--reviewer', 'nyabongo'], options)).toBe(1);
    expect(errors[0]).toMatch(/MK\.1\.1\.json: cannot read file/);
  });

  it('lets unexpected errors through', async () => {
    const { options } = setup({
      fs: {
        readFile: () => readFileSync(FIXTURE, 'utf8'),
        writeFile: () => {
          throw new Error('disk full');
        },
        rename: () => undefined,
        remove: () => undefined,
      },
    });
    await expect(runApprove(['passages/MT.20.1-16.json', '--reviewer', 'nyabongo'], options)).rejects.toThrow(
      'disk full',
    );
  });
});
