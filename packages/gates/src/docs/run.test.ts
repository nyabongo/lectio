import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { DOCS_USAGE, runGatesDocs } from './run.ts';
import type { GatesDocsCliOptions } from './run.ts';

const dirs: string[] = [];

/** A scratch repository root (a package.json with workspaces) holding `docs/`. */
function scratchRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'lectio-gates-docs-'));
  dirs.push(root);
  writeFileSync(join(root, 'package.json'), JSON.stringify({ workspaces: ['packages/*'] }));
  mkdirSync(join(root, 'docs'));
  mkdirSync(join(root, 'packages', 'gates'), { recursive: true });
  return root;
}

function setup(overrides: Partial<GatesDocsCliOptions> = {}) {
  const root = scratchRepo();
  const logs: string[] = [];
  const errors: string[] = [];
  const options: GatesDocsCliOptions = {
    cwd: join(root, 'packages', 'gates'),
    log: (line) => logs.push(line),
    error: (line) => errors.push(line),
    render: () => Promise.resolve('# Content gates\n'),
    ...overrides,
  };
  return { root, doc: join(root, 'docs', 'gates.md'), logs, errors, options };
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('gates:docs', () => {
  it('writes docs/gates.md at the repository root, then reports it unchanged', async () => {
    const { doc, logs, errors, options } = setup();
    expect(await runGatesDocs(['--'], options)).toBe(0);
    expect(readFileSync(doc, 'utf8')).toBe('# Content gates\n');
    expect(await runGatesDocs([], options)).toBe(0);
    expect(logs).toEqual(['wrote docs/gates.md', 'docs/gates.md unchanged']);
    expect(errors).toEqual([]);
  });

  it('--check passes when in sync and fails without writing when out of date', async () => {
    const { doc, logs, errors, options } = setup();
    expect(await runGatesDocs(['--check'], options)).toBe(1);
    expect(errors).toEqual(['gates:docs: docs/gates.md is out of date; run npm run gates:docs']);
    writeFileSync(doc, '# Old\n');
    expect(await runGatesDocs(['--check'], options)).toBe(1);
    expect(readFileSync(doc, 'utf8')).toBe('# Old\n');
    writeFileSync(doc, '# Content gates\n');
    expect(await runGatesDocs(['--check'], options)).toBe(0);
    expect(logs).toEqual(['docs/gates.md is up to date']);
  });

  it('uses injected file access', async () => {
    const writes: [string, string][] = [];
    const { doc, options } = setup({ readFile: () => null, writeFile: (path, text) => writes.push([path, text]) });
    expect(await runGatesDocs([], options)).toBe(0);
    expect(writes).toEqual([[doc, '# Content gates\n']]);
  });

  it('prints usage for --help and on an unknown option', async () => {
    const { logs, errors, options } = setup();
    expect(await runGatesDocs(['--help'], options)).toBe(0);
    expect(logs).toEqual([DOCS_USAGE]);
    expect(await runGatesDocs(['--nope'], options)).toBe(2);
    expect(errors[0]).toMatch(/^gates:docs: .*--nope/);
    expect(errors[1]).toBe(DOCS_USAGE);
  });

  it('lets a read error other than a missing file through', async () => {
    const { doc, options } = setup();
    mkdirSync(doc);
    await expect(runGatesDocs([], options)).rejects.toThrow(/EISDIR/);
  });

  it('renders the real document by default', async () => {
    const { doc, options } = setup({ render: undefined });
    expect(await runGatesDocs([], { ...options, render: undefined })).toBe(0);
    expect(readFileSync(doc, 'utf8')).toMatch(/^# Content gates\n/);
  });
});
