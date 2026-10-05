import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { listSubdirectories } from './corpus.ts';
import { formatLicences, listLicences } from './licences.ts';

const fixtureRoot = fileURLToPath(new URL('./fixtures/corpus', import.meta.url));

const EXPECTED = `grc-test: Greek test edition (fragment of the SBL Greek New Testament)
  Licence: CC-BY-4.0
  Source: https://example.test/grc-test.tar.gz (fixture-1)
  Fragment of the SBL Greek New Testament.
  Copyright 2010 Society of Biblical Literature and Logos Bible Software.

hbo-test: Hebrew test edition (fragment of the Westminster Leningrad Codex)
  Licence: LicenseRef-PublicDomain
  Source: https://example.test/hbo-test.tar.gz (fixture-1)
  Fragment of the Westminster Leningrad Codex (public domain).

lat-test: Latin test edition (synthetic)
  Licence: CC0-1.0
  Source: https://example.test/lat-test.tar.gz (fixture-1)
  Synthetic Latin tokens written for the tests.
`;

describe('listLicences / formatLicences', () => {
  it('prints every edition in a fixed format', async () => {
    const entries = await listLicences(fixtureRoot);
    expect(entries.map((entry) => entry.edition)).toEqual(['grc-test', 'hbo-test', 'lat-test']);
    expect(entries[0]).toMatchObject({ licence: 'CC-BY-4.0', language: 'grc' });
    expect(formatLicences(entries)).toBe(EXPECTED);
  });

  it('is deterministic whatever order the file system lists editions in', async () => {
    const reversed = await listLicences(fixtureRoot, {
      listDirectories: async (path) => (await listSubdirectories(path)).reverse(),
    });
    expect(formatLicences(reversed)).toBe(EXPECTED);
    expect(formatLicences(await listLicences(fixtureRoot))).toBe(formatLicences(await listLicences(fixtureRoot)));
  });

  it('says so when there are no editions', async () => {
    expect(formatLicences(await listLicences(join(fixtureRoot, 'absent')))).toBe('No corpus editions found.\n');
  });

  it('fails on an invalid SOURCE.json rather than printing a partial list', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lectio-licences-'));
    try {
      await mkdir(join(root, 'a-ok'));
      await writeFile(join(root, 'a-ok', 'SOURCE.json'), await readFile(join(fixtureRoot, 'lat-test', 'SOURCE.json')));
      await mkdir(join(root, 'b-bad'));
      await writeFile(join(root, 'b-bad', 'SOURCE.json'), '[]');
      await expect(listLicences(root)).rejects.toThrow(/b-bad.SOURCE\.json: expected an object/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
