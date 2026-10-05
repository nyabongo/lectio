import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { OLM, REGISTRY_JSON } from './fixtures/data.ts';
import { listBlocks, loadBlock, loadLectionary, loadRegistry } from './load.ts';

const temps: string[] = [];
afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tree(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'lectio-lect-'));
  temps.push(root);
  for (const [path, text] of Object.entries(files)) {
    await mkdir(join(root, path, '..'), { recursive: true });
    await writeFile(join(root, path), text);
  }
  return root;
}

const dataFile = JSON.stringify({
  kind: 'commons',
  entries: [
    {
      key: 'apostles',
      masses: [{ id: 'day', readings: [{ slot: 'gospel', ref: 'Mt 10:1-4', source: OLM, status: 'provisional' }] }],
    },
  ],
});

describe('loadLectionary', () => {
  it('reads the registry and every block, skipping tooling directories and non-JSON files', async () => {
    const root = await tree({
      'sources.json': JSON.stringify(REGISTRY_JSON),
      'b/one.json': dataFile,
      'a/two.json': dataFile.replace('apostles', 'martyrs'),
      'a/notes.txt': 'x',
      'crosscheck/a.json': '{}',
      'disputes/a.md': '',
      'import/litcal/a.json': '{}',
    });
    expect(await listBlocks(root)).toEqual(['a', 'b']);
    const loaded = await loadLectionary(root);
    expect(loaded.problems).toEqual([]);
    expect(Object.keys(loaded.registry.sources)).toEqual(['litcal', 'olm-1981', 'ke-lect-2020']);
    expect(loaded.files.map((f) => [f.block, f.path, f.data.entries[0]?.key])).toEqual([
      ['a', 'a/two.json', 'martyrs'],
      ['b', 'b/one.json', 'apostles'],
    ]);
    expect((await loadLectionary(root, ['b'])).files).toHaveLength(1);
  });

  it('reports unreadable, invalid and missing files', async () => {
    const root = await tree({ 'a/bad.json': '{', 'a/shape.json': '{"kind":"commons"}', 'a/ok.json': dataFile });
    const loaded = await loadLectionary(root, ['a', 'missing']);
    expect(loaded.registry.sources).toEqual({});
    expect(loaded.files.map((f) => f.path)).toEqual(['a/ok.json']);
    expect(loaded.problems[0]).toMatch(/^sources\.json: ENOENT/);
    expect(loaded.problems[1]).toMatch(/^a\/bad\.json: /);
    expect(loaded.problems[2]).toBe('a/shape.json: "entries" is required');
    expect(loaded.problems[3]).toMatch(/^block "missing" does not exist/);
  });

  it('loads a registry and a block on their own', async () => {
    const root = await tree({ 'sources.json': '{"sources":{}}', 'a/ok.json': dataFile });
    expect(await loadRegistry(root)).toEqual({ registry: { sources: {} }, problems: [] });
    expect((await loadBlock(root, 'a')).files).toHaveLength(1);
  });
});
