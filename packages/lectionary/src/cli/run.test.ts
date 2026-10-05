import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { server } from '@lectio/shared/test-server';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { DATA_ROOT, SHA } from '../fixtures/data.ts';
import type { TextFetcher } from '../import/litcal.ts';
import { httpFetcher, resolveLectionaryRoot, runCheck, runCrosscheck, runImportLitcal } from './run.ts';

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, io: { out: (line: string) => out.push(line), err: (line: string) => err.push(line) } };
}

const temps: string[] = [];
afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** A writable copy of the committed calendar/lectionary directory. */
async function copyOfData(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'lectio-lect-cli-'));
  temps.push(root);
  await cp(DATA_ROOT, root, { recursive: true });
  return root;
}

async function edit(path: string, change: (json: Record<string, unknown>) => void): Promise<void> {
  const json = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
  change(json);
  await writeFile(path, JSON.stringify(json));
}

describe('resolveLectionaryRoot', () => {
  const repo = resolve(DATA_ROOT, '../..');
  it('finds calendar/lectionary in the workspace root above INIT_CWD or cwd', () => {
    expect(resolveLectionaryRoot({ INIT_CWD: join(repo, 'packages', 'lectionary') }, '/')).toBe(DATA_ROOT);
    expect(resolveLectionaryRoot({}, join(repo, 'packages', 'lectionary', 'src'))).toBe(DATA_ROOT);
  });

  it('honours LECTIO_LECTIONARY_ROOT, relative to INIT_CWD', () => {
    expect(resolveLectionaryRoot({ LECTIO_LECTIONARY_ROOT: 'data', INIT_CWD: '/x' }, '/y')).toBe('/x/data');
    expect(resolveLectionaryRoot({ LECTIO_LECTIONARY_ROOT: '' }, repo)).toBe(DATA_ROOT);
  });

  it('fails outside a workspace, skipping unreadable manifests', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lectio-noroot-'));
    temps.push(dir);
    await writeFile(join(dir, 'package.json'), '{');
    expect(() => resolveLectionaryRoot({}, dir)).toThrow(/no workspace root above/);
  });
});

describe('runCheck', () => {
  it('passes the committed data', async () => {
    const { out, err, io } = capture();
    expect(await runCheck([], DATA_ROOT, io)).toBe(0);
    expect(out).toEqual([
      'lectionary:check: 2 files, 15 entries, 47 readings (47 provisional, 0 verified, 0 disputed)',
      '  39 OLM 1981 citations have no page yet (p?)',
    ]);
    expect(err).toEqual([]);
  });

  it('passes an empty data directory without mentioning OLM pages', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lectio-lect-empty-'));
    temps.push(root);
    await writeFile(join(root, 'sources.json'), '{"sources":{}}');
    const { out, io } = capture();
    expect(await runCheck([], root, io)).toBe(0);
    expect(out).toEqual(['lectionary:check: 0 files, 0 entries, 0 readings (0 provisional, 0 verified, 0 disputed)']);
  });

  it('reports problems and usage errors', async () => {
    const root = await copyOfData();
    await edit(join(root, 'seed', 'celebrations.json'), (json) => {
      const [entry] = json['entries'] as { masses: { readings: { ref: string; source: string }[] }[] }[];
      const first = entry?.masses[0]?.readings[0] as { ref: string; source: string };
      first.ref = 'Eph 4:1-7, 11-13a';
      first.source = `olm-1981@${SHA} p1#643`;
    });
    const a = capture();
    expect(await runCheck(['--block', 'seed'], root, a.io)).toBe(1);
    expect(a.err).toEqual([
      '2 problems:',
      '  seed/celebrations.json matthew-apostle day first-reading: ref "Eph 4:1-7, 11-13a" has verse letters; keep them in "printed" only',
      `  seed/celebrations.json matthew-apostle day first-reading: source "olm-1981@${SHA} p1#643": olm-1981 is a print source and takes no @<revision>`,
    ]);
    await writeFile(join(root, 'seed', 'celebrations.json'), '{"kind":"commons"}');
    const b = capture();
    expect(await runCheck([], root, b.io)).toBe(1);
    expect(b.err).toEqual(['1 problem:', '  seed/celebrations.json: "entries" is required']);
    const c = capture();
    expect(await runCheck(['--nope'], root, c.io)).toBe(2);
    expect(c.err[0]).toMatch(/^usage/);
    expect(await runCheck(['--calendar'], root, c.io)).toBe(2);
  });

  it('checks a feast on a Sunday against calendar year files', async () => {
    const root = await copyOfData();
    const day = (date: string, rank: string) => ({
      date,
      season: 'ordinary-time',
      seasonWeek: 25,
      sundayCycle: 'C',
      weekdayCycle: 'I',
      celebrations: [{ id: 'matthew-apostle', name: 'St Matthew', rank, colour: 'red' }],
      masses: [],
      lectionaryMissing: true,
    });
    const calendar = join(root, '2025.json');
    await writeFile(
      calendar,
      JSON.stringify({
        year: 2025,
        region: 'kenya',
        generatedBy: 'test',
        days: [day('2025-09-21', 'feast'), day('2025-09-22', 'feast')],
      }),
    );
    await writeFile(join(root, 'bad.json'), '{"year": 2025}');
    const a = capture();
    expect(await runCheck(['--block', 'seed', '--calendar', calendar], root, a.io)).toBe(1);
    expect(a.err).toEqual([
      '1 problem:',
      '  2025-09-21 matthew-apostle day: a feast on a Sunday needs a second reading (from celebrations:matthew-apostle)',
    ]);
    const b = capture();
    const missing = join(root, 'missing.json');
    expect(
      await runCheck(['--block', 'seed', '--calendar', join(root, 'bad.json'), '--calendar', missing], root, b.io),
    ).toBe(1);
    expect(b.err).toEqual([
      '2 problems:',
      `  ${join(root, 'bad.json')}: not a valid calendar year file`,
      expect.stringMatching(new RegExp(`^  ${missing}: ENOENT`)),
    ]);
  });
});

describe('runCrosscheck', () => {
  it('writes the committed disputes file for the seed block, with no disagreements', async () => {
    const root = await copyOfData();
    await rm(join(root, 'disputes'), { recursive: true });
    const { out, io } = capture();
    expect(await runCrosscheck(['--block', 'seed'], root, io)).toBe(0);
    expect(out).toEqual([
      'lectionary:crosscheck seed: 8 compared, 8 agree, 0 disagree, 39 single-source → disputes/seed.md',
    ]);
    const written = await readFile(join(root, 'disputes', 'seed.md'), 'utf8');
    expect(written).toBe(await readFile(join(DATA_ROOT, 'disputes', 'seed.md'), 'utf8'));
  });

  it('exits 1 when there are disagreements', async () => {
    const root = await copyOfData();
    await edit(join(root, 'crosscheck', 'seed.json'), (json) => {
      const [first] = json['entries'] as { ref: string }[];
      (first as { ref: string }).ref = 'Is 55:6-11';
    });
    const { out, io } = capture();
    expect(await runCrosscheck(['--block', 'seed'], root, io)).toBe(1);
    expect(out[0]).toMatch(/7 agree, 1 disagree/);
    expect(await readFile(join(root, 'disputes', 'seed.md'), 'utf8')).toContain(
      'passage differs: ours IS.55.6-9, theirs IS.55.6-11',
    );
  });

  it('refuses a block that fails the check, and bad or missing cross-check files', async () => {
    const root = await copyOfData();
    const usage = capture();
    expect(await runCrosscheck(['--block'], root, usage.io)).toBe(2);
    expect(await runCrosscheck(['--block', 'Seed'], root, usage.io)).toBe(2);
    expect(await runCrosscheck(['--block', 'seed', 'x'], root, usage.io)).toBe(2);

    const wrongBlock = capture();
    await edit(join(root, 'crosscheck', 'seed.json'), (json) => {
      json['block'] = 'other';
    });
    expect(await runCrosscheck(['--block', 'seed'], root, wrongBlock.io)).toBe(1);
    expect(wrongBlock.err).toEqual(['crosscheck/seed.json is invalid:', '  "block" is "other", expected "seed"']);

    const invalid = capture();
    await writeFile(join(root, 'crosscheck', 'seed.json'), '{}');
    expect(await runCrosscheck(['--block', 'seed'], root, invalid.io)).toBe(1);
    expect(invalid.err[1]).toMatch(/expected \{ "block"/);

    const missing = capture();
    await rm(join(root, 'crosscheck', 'seed.json'));
    expect(await runCrosscheck(['--block', 'seed'], root, missing.io)).toBe(1);
    expect(missing.err[0]).toMatch(/^crosscheck\/seed\.json: ENOENT/);

    const failing = capture();
    await mkdir(join(root, 'broken'));
    await writeFile(join(root, 'broken', 'x.json'), '{"kind":"commons","entries":[{"key":"x","masses":[]}]}');
    expect(await runCrosscheck(['--block', 'broken'], root, failing.io)).toBe(1);
    expect(failing.err).toEqual([
      'block "broken" fails lectionary:check; fix it first:',
      '  broken/x.json x: has no masses and no common',
    ]);
  });
});

/** Serves the pinned LitCal Sunday file from the committed seed data's printed strings. */
function litcalFetcher(calls: string[], secondOf26 = 'Philippians 2:1-11|Philippians 2:1-5'): TextFetcher {
  const sunday = (first: string, psalm: string, second: string, gospel: string) => ({
    first_reading: first,
    responsorial_psalm: psalm,
    ...(second === '' ? {} : { second_reading: second }),
    gospel_acclamation: '',
    gospel,
  });
  const json = {
    OrdSunday25: sunday('Isaiah 55:6-9', 'Psalm 145:2-3, 8-9, 17-18', 'Philippians 1:20c-24, 27a', 'Matthew 20:1-16a'),
    OrdSunday26: sunday('Ezekiel 18:25-28', 'Psalm 25:4-5, 6-7, 8-9', secondOf26, 'Matthew 21:28-32'),
  };
  return {
    fetchText(url) {
      calls.push(url);
      return Promise.resolve(JSON.stringify(json));
    },
  };
}

describe('runImportLitcal', () => {
  it('re-importing the seed manifest reproduces the committed file', async () => {
    const root = await copyOfData();
    const calls: string[] = [];
    const { out, io } = capture();
    expect(await runImportLitcal(['seed'], root, io, litcalFetcher(calls))).toBe(0);
    expect(calls).toEqual([
      `https://raw.githubusercontent.com/Liturgical-Calendar/LiturgicalCalendarAPI/${SHA}/jsondata/sourcedata/rite/roman/lectionary/dominicale_et_festivum_A/en.json`,
    ]);
    expect(out).toEqual(['import-litcal seed: 0 added, 8 replaced → seed/proper-of-time.json']);
    const path = join('seed', 'proper-of-time.json');
    expect(await readFile(join(root, path), 'utf8')).toBe(await readFile(join(DATA_ROOT, path), 'utf8'));
  });

  it('creates the target file and reports readings it keeps', async () => {
    const root = await copyOfData();
    await rm(join(root, 'seed', 'proper-of-time.json'));
    const first = capture();
    expect(await runImportLitcal(['seed'], root, first.io, litcalFetcher([]))).toBe(0);
    expect(first.out).toEqual(['import-litcal seed: 8 added, 0 replaced → seed/proper-of-time.json']);
    const target = join(root, 'seed', 'proper-of-time.json');
    expect((await readFile(target, 'utf8')).startsWith('{\n  "kind": "proper-of-time"')).toBe(true);
    await edit(target, (json) => {
      const [entry] = json['entries'] as { masses: { readings: { status: string }[] }[] }[];
      (entry?.masses[0]?.readings[0] as { status: string }).status = 'verified';
    });
    const second = capture();
    expect(await runImportLitcal(['seed'], root, second.io, litcalFetcher([]))).toBe(0);
    expect(second.out).toEqual([
      'import-litcal seed: 0 added, 7 replaced → seed/proper-of-time.json',
      '  kept (verified, disputed or from another source): ot-sunday-25 day first-reading (A)',
    ]);
  });

  it('removes and reports a LitCal reading the leaf no longer has', async () => {
    const root = await copyOfData();
    const { out, io } = capture();
    expect(await runImportLitcal(['seed'], root, io, litcalFetcher([], ''))).toBe(0);
    expect(out).toEqual([
      'import-litcal seed: 0 added, 7 replaced → seed/proper-of-time.json',
      '  removed (no longer in the LitCal leaf): ot-sunday-26 day second-reading (A)',
    ]);
    const written = await readFile(join(root, 'seed', 'proper-of-time.json'), 'utf8');
    expect(written).not.toContain('Philippians 2:1-11');
  });

  it('reports usage, manifest, registry, import and target problems without writing', async () => {
    const root = await copyOfData();
    const usage = capture();
    expect(await runImportLitcal([], root, usage.io, litcalFetcher([]))).toBe(2);
    expect(await runImportLitcal(['a', 'b'], root, usage.io, litcalFetcher([]))).toBe(2);
    expect(await runImportLitcal(['../x'], root, usage.io, litcalFetcher([]))).toBe(2);

    const missing = capture();
    expect(await runImportLitcal(['nope'], root, missing.io, litcalFetcher([]))).toBe(1);
    expect(missing.err[0]).toMatch(/^import\/litcal\/nope\.json: ENOENT/);

    const badManifest = capture();
    await writeFile(join(root, 'import', 'litcal', 'bad.json'), '{}');
    expect(await runImportLitcal(['bad'], root, badManifest.io, litcalFetcher([]))).toBe(1);
    expect(badManifest.err).toEqual(['  import/litcal/bad.json: expected { "target", "kind", "imports": [...] }']);

    const failing = capture();
    const broken: TextFetcher = { fetchText: () => Promise.reject(new Error('offline')) };
    expect(await runImportLitcal(['seed'], root, failing.io, broken)).toBe(1);
    expect(failing.err[0]).toBe('import failed; nothing written:');

    const wrongKind = capture();
    await edit(join(root, 'import', 'litcal', 'seed.json'), (json) => {
      json['target'] = 'seed/celebrations.json';
    });
    expect(await runImportLitcal(['seed'], root, wrongKind.io, litcalFetcher([]))).toBe(1);
    expect(wrongKind.err).toEqual(['seed/celebrations.json is not a valid proper-of-time file:']);

    const badRegistry = capture();
    await writeFile(join(root, 'sources.json'), '{}');
    expect(await runImportLitcal(['seed'], root, badRegistry.io, litcalFetcher([]))).toBe(1);
    expect(badRegistry.err).toEqual(['  sources.json: expected { "sources": { <id>: {...} } }']);
  });
});

describe('httpFetcher', () => {
  it('returns the body of a successful GET and throws on HTTP errors (offline, through msw)', async () => {
    server.use(
      http.get('https://litcal.test/ok.json', () => HttpResponse.text('{"a":1}')),
      http.get('https://litcal.test/missing.json', () => new HttpResponse(null, { status: 404 })),
    );
    const fetcher = httpFetcher();
    expect(await fetcher.fetchText('https://litcal.test/ok.json')).toBe('{"a":1}');
    await expect(fetcher.fetchText('https://litcal.test/missing.json')).rejects.toThrow(
      'GET https://litcal.test/missing.json: HTTP 404',
    );
  });
});
