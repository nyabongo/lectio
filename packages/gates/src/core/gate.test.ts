import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG } from '@lectio/config';
import type { ContentRepo } from '@lectio/content';
import { createProviders } from '@lectio/providers';

import { createContext, nodeReadText } from './gate.ts';
import type { Git } from './git.ts';

const here = fileURLToPath(new URL('.', import.meta.url)).replace(/\/$/, '');

const git: Git = {
  changedFiles: (base, head) => [{ path: `${base}..${head}.json`, status: 'added' }],
  show: (ref, path) => (path === 'missing' ? null : `${ref}:${path}`),
};

describe('createContext', () => {
  const providers = createProviders(DEFAULT_CONFIG);

  it('wires git, files, config and providers', () => {
    const repo = { root: 'x' } as ContentRepo;
    const context = createContext({
      root: '/repo',
      base: 'origin/main',
      head: 'HEAD',
      config: DEFAULT_CONFIG,
      providers,
      git,
      repo,
      readText: (path) => (path === '/repo/passages/A.1.json' ? 'text' : null),
    });
    expect(context.changedFiles).toEqual([{ path: 'origin/main..HEAD.json', status: 'added' }]);
    expect(context.readFile('passages/A.1.json')).toBe('text');
    expect(context.readFile('passages/B.json')).toBeNull();
    expect(context.readBase('a.json')).toBe('origin/main:a.json');
    expect(context.readBase('missing')).toBeNull();
    expect(context.repo).toBe(repo);
    expect(context.results).toEqual([]);
    expect(context).toMatchObject({
      root: '/repo',
      base: 'origin/main',
      head: 'HEAD',
      config: DEFAULT_CONFIG,
      providers,
      git,
    });
  });

  it('opens the content repository under the configured root by default and reads from disk', () => {
    const context = createContext({ root: here, base: 'b', head: 'h', config: DEFAULT_CONFIG, providers, git });
    expect(context.repo.root).toBe(here);
    expect(context.repo.passageKeys()).toEqual([]);
    expect(context.readFile('gate.ts')).toContain('export interface Gate');
  });
});

describe('nodeReadText', () => {
  it('returns null for a missing file and rethrows other errors', () => {
    expect(nodeReadText(`${here}/does-not-exist.json`)).toBeNull();
    expect(() => nodeReadText(here)).toThrow();
  });
});
