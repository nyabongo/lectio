import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { checkRootScripts, parsePlannedScript, planScriptRun, PLANNED_ROOT_SCRIPTS } from './planned-script.ts';
import type { Manifest } from './planned-script.ts';

const context = (existing: string[]) => ({
  exists: (path: string) => existing.includes(path),
  execPath: '/usr/bin/node',
  execArgv: ['--import', 'tsx'],
});

describe('planScriptRun', () => {
  it('prints not implemented until the owning issue creates the target', () => {
    expect(planScriptRun(['L-017', 'src/cli/build.ts', '--year', '2026'], context([]))).toEqual({
      kind: 'exit',
      code: 1,
      message: 'not implemented (L-017)',
    });
  });

  it('is a pure placeholder without a target', () => {
    expect(planScriptRun(['L-050'], context([]))).toEqual({
      kind: 'exit',
      code: 1,
      message: 'not implemented (L-050)',
    });
  });

  it('runs the target with tsx and forwards arguments once it exists', () => {
    expect(planScriptRun(['L-017', 'src/cli/build.ts', '--year', '2026'], context(['src/cli/build.ts']))).toEqual({
      kind: 'run',
      command: '/usr/bin/node',
      args: ['--import', 'tsx', 'src/cli/build.ts', '--year', '2026'],
    });
  });

  it('rejects a missing or malformed issue id', () => {
    const usage = { kind: 'exit', code: 2, message: 'usage: run-planned.mjs <L-NNN> [target] [...args]' };
    expect(planScriptRun([], context([]))).toEqual(usage);
    expect(planScriptRun(['17', 'x.ts'], context(['x.ts']))).toEqual(usage);
  });
});

describe('parsePlannedScript', () => {
  it('extracts issue and target', () => {
    expect(parsePlannedScript('tsx ../../scripts/run-planned.mjs L-017 src/cli/build.ts')).toEqual({
      issue: 'L-017',
      target: 'src/cli/build.ts',
    });
    expect(parsePlannedScript('tsx ../../scripts/run-planned.mjs L-021a')).toEqual({ issue: 'L-021a' });
  });

  it('ignores other commands', () => {
    expect(parsePlannedScript('tsc -p tsconfig.json')).toBeUndefined();
    expect(parsePlannedScript('tsx ../../scripts/run-planned.mjs later src/x.ts')).toBeUndefined();
  });
});

describe('checkRootScripts', () => {
  const allRoot = (overrides: Record<string, string> = {}): Manifest => ({
    name: 'lectio',
    scripts: {
      ...Object.fromEntries(PLANNED_ROOT_SCRIPTS.map((name) => [name, `npm run -w @lectio/x ${name} --`])),
      ...overrides,
    },
  });
  const workspace: Manifest = {
    name: '@lectio/x',
    scripts: Object.fromEntries(PLANNED_ROOT_SCRIPTS.map((name) => [name, 'echo'])),
  };

  it('accepts root scripts that resolve to workspace scripts', () => {
    expect(checkRootScripts(allRoot(), [workspace])).toEqual([]);
  });

  it('reports missing, malformed and dangling root scripts', () => {
    const root = allRoot({ research: 'tsx research.ts', runway: 'npm run -w @lectio/nope runway --' });
    delete root.scripts?.['schema:emit'];
    const partial: Manifest = {
      name: '@lectio/x',
      scripts: { ...workspace.scripts, 'audio:render': undefined } as never,
    };
    expect(checkRootScripts(root, [partial, { name: '@lectio/empty' }])).toEqual([
      `root script 'research' must be "npm run -w @lectio/<pkg> <script> --"`,
      `root script 'audio:render': @lectio/x has no script 'audio:render'`,
      `root script 'schema:emit' is missing`,
      `root script 'runway' targets unknown workspace @lectio/nope`,
    ]);
    expect(checkRootScripts({ name: 'lectio' }, [])).toHaveLength(PLANNED_ROOT_SCRIPTS.length);
  });
});

describe('repository manifests', () => {
  const root = join(import.meta.dirname, '../../..');
  const read = (path: string): Manifest => JSON.parse(readFileSync(join(root, path), 'utf8')) as Manifest;
  const workspaceDirs = ['apps', 'packages'].flatMap((parent) =>
    readdirSync(join(root, parent))
      .map((dir) => `${parent}/${dir}`)
      .filter((dir) => existsSync(join(root, dir, 'package.json'))),
  );

  it('every pre-registered root script resolves to a workspace script', () => {
    const manifests = workspaceDirs.map((dir) => read(`${dir}/package.json`));
    expect(checkRootScripts(read('package.json'), manifests)).toEqual([]);
  });

  it('every planned workspace script names an owning issue', () => {
    for (const dir of workspaceDirs) {
      const { name, scripts = {} } = read(`${dir}/package.json`);
      expect(name).toBe(`@lectio/${dir.split('/')[1] as string}`);
      for (const command of Object.values(scripts)) {
        if (command.includes('run-planned.mjs')) expect(parsePlannedScript(command), command).toBeDefined();
      }
    }
  });
});
