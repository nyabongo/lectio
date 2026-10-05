import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, parse, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_CONFIG } from './defaults.ts';
import { ConfigError, DEFAULT_CONFIG_FILE, findRepoRoot, loadConfig, packageName, resolveConfigPath } from './index.ts';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

let dir: string;

// Each test gets a temp dir that is itself a fake repository root, so nothing
// above os.tmpdir() and nothing in the developer's environment affects results.
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lectio-config-'));
  makeRepo();
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

function write(relative: string, content: unknown): string {
  const path = join(dir, relative);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof content === 'string' ? content : JSON.stringify(content));
  return path;
}

/** Marks the temp dir as a repository root. */
function makeRepo(): void {
  write('package.json', { name: 'fake', workspaces: ['packages/*'] });
}

function loadError(run: () => unknown): ConfigError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigError);
    return error as ConfigError;
  }
  throw new Error('expected loadConfig to throw');
}

describe('loadConfig', () => {
  it('exports its package name', () => {
    expect(packageName).toBe('@lectio/config');
  });

  it('returns the defaults, frozen, when there is no config file', () => {
    const config = loadConfig(undefined, { cwd: dir, env: {} });
    expect(config).toEqual(DEFAULT_CONFIG);
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.reviewer.githubHandles)).toBe(true);
    expect(Object.isFrozen(config.linkout.providers.drbo)).toBe(true);
    expect(Object.isFrozen(DEFAULT_CONFIG)).toBe(true);
    expect(Object.isFrozen(DEFAULT_CONFIG.linkout.providers.drbo)).toBe(true);
  });

  it('encodes the owner decisions as defaults', () => {
    const config = loadConfig(undefined, { cwd: dir, env: {} });
    expect(config.linkout.provider).toBe('drbo');
    expect(config.linkout.providers.drbo?.builtin).toBe('drbo');
    expect(config.linkout.providers.usccb?.enabled).toBe(false);
    expect(config.linkout.providers.universalis?.enabled).toBe(false);
    expect(config.research.runner).toBe('local-cli');
    expect(config.research.budget.backfillTotalUsd).toBe(0);
    expect(config.autoMerge).toMatchObject({ minSupport: 0.9, requireBothVerifiers: true, maxRefutations: 0 });
    expect(config.reviewer.githubHandles).toEqual(['nyabongo']);
    expect(config.research.models.generator.model).toBe('claude-opus-5-5');
    expect(config.research.models.cheap.model).toBe('claude-haiku-4-5-20251001');
    expect(config.verifiers.confirmer.model).toBe('claude-sonnet-5-5');
    expect(config.tools.anthropic).toEqual({ webSearch: 'web_search_20260209', webFetch: 'web_fetch_20260209' });
    expect(config.lectionary).toMatchObject({
      primarySource: 'litcal',
      edition: 'OLM-1981',
      provisional: true,
    });
  });

  it('overrides only the keys a partial file gives', () => {
    const path = write('partial.json', { site: { locales: ['en', 'sw'] }, runway: { windowDays: 30 } });
    const config = loadConfig(path, { env: {} });
    expect(config.site.locales).toEqual(['en', 'sw']);
    expect(config.site.timezone).toBe('Africa/Nairobi');
    expect(config.runway).toEqual({ windowDays: 30, maxMissingDays: 7 });
    expect(config.reviewer).toEqual(DEFAULT_CONFIG.reviewer);
  });

  it('resolves an explicit relative path against the working directory', () => {
    write('sub/c.json', { content: { root: 'apps/web/test/fixtures/content' } });
    expect(loadConfig('sub/c.json', { cwd: dir, env: {} }).content.root).toBe('apps/web/test/fixtures/content');
  });

  it('throws with a JSON pointer for an invalid file', () => {
    const path = write('bad.json', { reviewer: { weeklyCapacity: -1 } });
    const error = loadError(() => loadConfig(path, { env: {} }));
    expect(error.source).toBe(path);
    expect(error.issues).toEqual([{ pointer: '/reviewer/weeklyCapacity', message: 'must be >= 0' }]);
    expect(error.message).toContain(`(${path})`);
  });

  it('rejects same-family verifiers in a file', () => {
    const path = write('fam.json', { verifiers: { confirmer: { family: 'openai', model: 'gpt-5' } } });
    expect(() => loadConfig(path, { env: {} })).toThrow(/different model families/);
  });

  it('throws for a missing explicit file and for invalid JSON', () => {
    expect(loadError(() => loadConfig(join(dir, 'missing.json'), { env: {} })).issues[0]?.message).toMatch(
      /^cannot read file/,
    );
    const path = write('broken.json', '{ nope');
    expect(loadError(() => loadConfig(path, { env: {} })).issues[0]?.message).toMatch(/^not valid JSON/);
  });

  it('honours LECTIO_CONFIG relative to the repository root', () => {
    write('apps/web/test/lectio.config.fixture.json', { site: { features: { listen: true } } });
    const env = { LECTIO_CONFIG: 'apps/web/test/lectio.config.fixture.json' };
    const config = loadConfig(undefined, { cwd: join(dir, 'apps/web'), env });
    expect(config.site.features.listen).toBe(true);
  });

  it('honours an absolute LECTIO_CONFIG and fails if it is missing', () => {
    const path = write('abs.json', { tts: { monthlyCharBudget: 5 } });
    expect(loadConfig(undefined, { cwd: dir, env: { LECTIO_CONFIG: path } }).tts.monthlyCharBudget).toBe(5);
    expect(() => loadConfig(undefined, { cwd: dir, env: { LECTIO_CONFIG: join(dir, 'gone.json') } })).toThrow(
      ConfigError,
    );
  });

  it('prefers an explicit path over LECTIO_CONFIG', () => {
    const explicit = write('explicit.json', { runway: { maxMissingDays: 1 } });
    const fromEnv = write('env.json', { runway: { maxMissingDays: 2 } });
    expect(loadConfig(explicit, { env: { LECTIO_CONFIG: fromEnv } }).runway.maxMissingDays).toBe(1);
  });

  it('reads config/lectio.config.json from the repository root found above the working directory', () => {
    write(DEFAULT_CONFIG_FILE, { research: { defaultDays: 7 } });
    mkdirSync(join(dir, 'packages/x'), { recursive: true });
    expect(loadConfig(undefined, { cwd: join(dir, 'packages/x'), env: {} }).research.defaultDays).toBe(7);
  });

  it('starts from INIT_CWD when no cwd is given', () => {
    write(DEFAULT_CONFIG_FILE, { research: { maxRepairs: 0 } });
    expect(loadConfig(undefined, { env: { INIT_CWD: dir } }).research.maxRepairs).toBe(0);
  });

  it('loads and validates the committed repository config', () => {
    const config = loadConfig(join(repoRoot, DEFAULT_CONFIG_FILE));
    expect(config.site.basePath).toBe('/lectio');
  });

  it('uses process.env and process.cwd() by default', () => {
    vi.stubEnv('LECTIO_CONFIG', '');
    vi.stubEnv('INIT_CWD', repoRoot);
    expect(loadConfig().site.basePath).toBe('/lectio');
    expect(resolveConfigPath(undefined, { env: {} }).path).toBe(join(findRepoRoot(process.cwd()), DEFAULT_CONFIG_FILE));
  });
});

describe('resolveConfigPath', () => {
  it('marks only the repository default as optional', () => {
    expect(resolveConfigPath(undefined, { cwd: dir, env: {} })).toEqual({
      path: join(dir, DEFAULT_CONFIG_FILE),
      required: false,
    });
    expect(resolveConfigPath('', { cwd: dir, env: { LECTIO_CONFIG: '' } }).required).toBe(false);
    expect(resolveConfigPath('a.json', { cwd: dir, env: {} })).toEqual({ path: join(dir, 'a.json'), required: true });
  });
});

describe('findRepoRoot', () => {
  it('finds the nearest package.json with workspaces', () => {
    write('packages/a/package.json', { name: 'a' });
    expect(findRepoRoot(join(dir, 'packages/a'))).toBe(dir);
  });

  it('skips unreadable and workspace-less manifests', () => {
    write('a/package.json', '{ broken');
    write('a/b/package.json', '[1]');
    write('a/b/c/package.json', { name: 'c' });
    expect(findRepoRoot(join(dir, 'a/b/c'))).toBe(dir);
  });

  it('falls back to the start directory when no root is found', () => {
    const fsRoot = parse(dir).root;
    expect(findRepoRoot(fsRoot)).toBe(fsRoot);
  });

  it('finds this repository', () => {
    expect(JSON.parse(readFileSync(join(findRepoRoot(repoRoot), 'package.json'), 'utf8'))).toMatchObject({
      name: 'lectio',
    });
  });
});
