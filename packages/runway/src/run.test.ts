import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DEFAULT_CONFIG } from '@lectio/config';
import { GhGitHubClient } from '@lectio/provider-gh';
import { FakeGitHubClient } from '@lectio/providers';
import type { GitHubClient } from '@lectio/providers';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { fixtureRepo } from './fixtures/memory-repo.ts';
import { USAGE, parseArgs, processContext, runRunway } from './run.ts';
import type { CliContext } from './run.ts';

function io() {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, io: { out: (line: string) => out.push(line), err: (line: string) => err.push(line) } };
}

const repo = fixtureRepo({
  days: { '2026-10-05': [['MT.20.1-16']], '2026-10-06': [['IS.55.6-9']] },
  approved: ['IS.55.6-9'],
});

function context(github: () => GitHubClient = () => new FakeGitHubClient()): CliContext {
  return {
    config: { site: DEFAULT_CONFIG.site, runway: { windowDays: 2, maxMissingDays: 0 } },
    repo,
    // 2026-10-04T22:30Z is already 2026-10-05 in Africa/Nairobi (UTC+3).
    now: () => new Date('2026-10-04T22:30:00Z'),
    github,
  };
}

describe('parseArgs', () => {
  it('accepts --from and --dry-run in any order', () => {
    expect(parseArgs([])).toEqual({ dryRun: false });
    expect(parseArgs(['--dry-run', '--from', '2026-10-05'])).toEqual({ from: '2026-10-05', dryRun: true });
  });

  it('rejects unknown, repeated or malformed arguments', () => {
    expect(parseArgs(['--bogus'])).toBe('unexpected argument "--bogus"');
    expect(parseArgs(['--from', 'tomorrow'])).toBe('unexpected argument "--from"');
    expect(parseArgs(['--from'])).toBe('unexpected argument "--from"');
    expect(parseArgs(['--dry-run', '--dry-run'])).toBe('unexpected argument "--dry-run"');
    expect(parseArgs(['--from', '2026-10-05', '--from', '2026-10-06'])).toBe('unexpected argument "--from"');
  });
});

describe('runRunway', () => {
  it('upserts the issue from today in the site time zone', async () => {
    const github = new FakeGitHubClient({ actor: 'github-actions[bot]' });
    const { out, err, io: cliIo } = io();
    expect(
      await runRunway(
        [],
        context(() => github),
        cliIo,
      ),
    ).toBe(0);
    expect(err).toEqual([]);
    expect(out[0]).toBe('runway: 1 of 2 days from 2026-10-05 to 2026-10-06 lack approved notes (max 0): exceeded');
    expect(out[1]).toMatch(/^runway: issue #1 created, open \(.+\)$/);
    expect(
      await runRunway(
        ['--from', '2026-10-06'],
        context(() => github),
        cliIo,
      ),
    ).toBe(0);
    expect(out[2]).toBe('runway: 1 of 2 days from 2026-10-06 to 2026-10-07 lack approved notes (max 0): exceeded');
    expect(out[3]).toMatch(/^runway: issue #1 updated, open/);
  });

  it('prints the report without touching GitHub on --dry-run', async () => {
    const github = vi.fn<() => GitHubClient>();
    const { out, io: cliIo } = io();
    expect(await runRunway(['--dry-run', '--from', '2026-10-06'], context(github), cliIo)).toBe(0);
    expect(github).not.toHaveBeenCalled();
    expect(out[0]).toBe('runway: 1 of 2 days from 2026-10-06 to 2026-10-07 lack approved notes (max 0): exceeded');
    expect(out[1]).toContain('| 2026-10-07 | no calendar entry');
  });

  it('reports a healthy runway', async () => {
    const { out, io: cliIo } = io();
    const healthy = {
      ...context(),
      config: { site: DEFAULT_CONFIG.site, runway: { windowDays: 1, maxMissingDays: 0 } },
    };
    expect(await runRunway(['--from', '2026-10-06'], healthy, cliIo)).toBe(0);
    expect(out[0]).toMatch(/: healthy$/);
    expect(out[1]).toMatch(/created, closed/);
  });

  it('returns 2 with the usage on bad arguments', async () => {
    const { err, io: cliIo } = io();
    expect(await runRunway(['--nope'], context(), cliIo)).toBe(2);
    expect(err).toEqual([`unexpected argument "--nope"\n${USAGE}`]);
  });

  it('returns 1 when GitHub or the content fails', async () => {
    const { err, io: cliIo } = io();
    const failing = context(() => {
      throw new Error('gh: not logged in');
    });
    expect(await runRunway([], failing, cliIo)).toBe(1);
    expect(await runRunway([], { ...context(), now: () => new Date(Number.NaN) }, cliIo)).toBe(1);
    const thrower = context(() => {
      throw 'plain failure';
    });
    expect(await runRunway([], thrower, cliIo)).toBe(1);
    expect(err).toEqual(['runway: gh: not logged in', 'runway: Invalid Date', 'runway: plain failure']);
  });
});

describe('processContext', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  function makeRepo(): string {
    dir = mkdtempSync(join(tmpdir(), 'lectio-runway-'));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ workspaces: ['packages/*'] }));
    mkdirSync(join(dir, 'config'));
    writeFileSync(join(dir, 'config', 'lectio.config.json'), JSON.stringify({ content: { root: 'content' } }));
    mkdirSync(join(dir, 'packages', 'runway'), { recursive: true });
    return dir;
  }

  it('loads the config and opens the content root found from INIT_CWD, with a bot client under Actions', () => {
    const root = makeRepo();
    const ctx = processContext(
      { INIT_CWD: join(root, 'packages', 'runway'), GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'nyabongo/lectio' },
      '/nowhere',
    );
    expect(ctx.config.runway).toEqual(DEFAULT_CONFIG.runway);
    expect(ctx.repo.root).toBe(join(root, 'content'));
    expect(ctx.repo.years()).toEqual([]);
    expect(ctx.now()).toBeInstanceOf(Date);
    const github = ctx.github();
    expect(github).toBeInstanceOf(GhGitHubClient);
    return expect(github.viewer()).resolves.toBe('github-actions[bot]');
  });

  it('falls back to cwd and a default client outside Actions', () => {
    const root = makeRepo();
    const ctx = processContext({ GITHUB_REPOSITORY: '' }, root);
    expect(ctx.repo.root).toBe(join(root, 'content'));
    expect(ctx.github()).toBeInstanceOf(GhGitHubClient);
  });
});
