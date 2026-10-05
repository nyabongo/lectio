import { describe, expect, it } from 'vitest';

import { LITCAL, REGISTRY, REGISTRY_JSON, SHA, reading } from '../fixtures/data.ts';
import { parseRegistry } from '../sources.ts';
import { importLitcal, mergeImported, parseManifest, serialiseBlockFile } from './litcal.ts';
import type { LitcalManifest, TextFetcher } from './litcal.ts';

const BASE = `https://example.test/litcal/${SHA}/roman/`;

/** LitCal-shaped test data (citations only). */
const FILES: Record<string, unknown> = {
  [`${BASE}lectionary/dominicale_et_festivum_A/en.json`]: {
    OrdSunday25: {
      first_reading: 'Isaiah 55:6-9',
      responsorial_psalm: 'Psalm 145:2-3, 8-9, 17-18',
      second_reading: 'Philippians 1:20c-24, 27a',
      gospel_acclamation: 'Cf. Acts 16:14b',
      gospel: 'Matthew 20:1-16a',
    },
    OrdSunday26: { second_reading: 'Philippians 2:1-11|Philippians 2:1-5', gospel: '' },
    Christmas: { vigil: { gospel: 'Matthew 1:1-25|Matthew 1:18-25' } },
    Empty: { first_reading: '', gospel_acclamation: '' },
    Odd: { first_reading: 'Nowhere 1:1', homily: 'x' },
    Scalar: 'x',
  },
  [`${BASE}decrees/lectionary/en.json`]: { StMaryMagdalene: { gospel: 'John 20:1-2, 11-18' } },
};

function fakeFetcher(calls: string[] = []): TextFetcher {
  return {
    fetchText(url) {
      calls.push(url);
      const json = FILES[url];
      return json === undefined
        ? Promise.reject(new Error(`GET ${url}: HTTP 404`))
        : Promise.resolve(JSON.stringify(json));
    },
  };
}

const manifest = (imports: LitcalManifest['imports']): LitcalManifest => ({
  target: 'seed/proper-of-time.json',
  kind: 'proper-of-time',
  imports,
});

describe('importLitcal', () => {
  it('converts leaves into provisional readings at the pinned revision, fetching each file once', async () => {
    const calls: string[] = [];
    const { readings, problems } = await importLitcal(
      manifest([
        { key: 'ot-sunday-25', cycle: 'A', locator: 'dominicale_et_festivum_A/en.json#OrdSunday25' },
        { key: 'ot-sunday-26', cycle: 'A', locator: 'dominicale_et_festivum_A/en.json#OrdSunday26' },
        { key: 'christmas', mass: 'vigil', locator: 'dominicale_et_festivum_A/en.json#Christmas.vigil' },
        { key: 'mary-magdalene', locator: 'decrees/lectionary/en.json#StMaryMagdalene' },
      ]),
      REGISTRY,
      fakeFetcher(calls),
    );
    expect(problems).toEqual([]);
    expect(calls).toEqual([`${BASE}lectionary/dominicale_et_festivum_A/en.json`, `${BASE}decrees/lectionary/en.json`]);
    expect(readings.slice(0, 4).map((r) => r.reading)).toEqual([
      reading('first-reading', 'Is 55:6-9', { cycle: 'A', printed: 'Isaiah 55:6-9', source: LITCAL }),
      reading('psalm', 'Ps 145:2-3, 8-9, 17-18', { cycle: 'A', printed: 'Psalm 145:2-3, 8-9, 17-18', source: LITCAL }),
      reading('second-reading', 'Phil 1:20-24, 27', {
        cycle: 'A',
        printed: 'Philippians 1:20c-24, 27a',
        source: LITCAL,
      }),
      reading('gospel', 'Mt 20:1-16', { cycle: 'A', printed: 'Matthew 20:1-16a', source: LITCAL }),
    ]);
    expect(readings[4]?.reading.alternatives).toEqual([{ ref: 'Phil 2:1-5', printed: 'Philippians 2:1-5' }]);
    expect(readings.slice(4).map((r) => [r.key, r.mass, r.reading.slot, r.reading.ref, r.reading.source])).toEqual([
      [
        'ot-sunday-26',
        'day',
        'second-reading',
        'Phil 2:1-11',
        `litcal@${SHA} dominicale_et_festivum_A/en.json#OrdSunday26`,
      ],
      ['christmas', 'vigil', 'gospel', 'Mt 1:1-25', `litcal@${SHA} dominicale_et_festivum_A/en.json#Christmas.vigil`],
      [
        'mary-magdalene',
        'day',
        'gospel',
        'Jn 20:1-2, 11-18',
        `litcal@${SHA} decrees/lectionary/en.json#StMaryMagdalene`,
      ],
    ]);
    expect(readings[5]?.reading.cycle).toBeUndefined();
  });

  it('reports bad locators, missing files and leaves, empty leaves and bad citations', async () => {
    const { readings, problems } = await importLitcal(
      manifest([
        { key: 'a', locator: '../en.json#X' },
        { key: 'b', locator: 'missing/en.json#X' },
        { key: 'c', locator: 'dominicale_et_festivum_A/en.json#Nope' },
        { key: 'd', locator: 'dominicale_et_festivum_A/en.json#Scalar.vigil' },
        { key: 'e', locator: 'dominicale_et_festivum_A/en.json#Empty' },
        { key: 'f', locator: 'dominicale_et_festivum_A/en.json#Odd' },
      ]),
      REGISTRY,
      fakeFetcher(),
    );
    expect(readings).toEqual([]);
    expect(problems).toEqual([
      'a ← ../en.json#X: not a litcal locator',
      `b ← missing/en.json#X: GET ${BASE}lectionary/missing/en.json: HTTP 404`,
      'c ← dominicale_et_festivum_A/en.json#Nope: no such leaf in dominicale_et_festivum_A/en.json',
      'd ← dominicale_et_festivum_A/en.json#Scalar.vigil: no such leaf in dominicale_et_festivum_A/en.json',
      'e ← dominicale_et_festivum_A/en.json#Empty: the leaf has no readings',
      'f ← dominicale_et_festivum_A/en.json#Odd first_reading: Unknown book "Nowhere" (in "Nowhere 1:1")',
      'f ← dominicale_et_festivum_A/en.json#Odd: unknown LitCal slot "homily"',
      'f ← dominicale_et_festivum_A/en.json#Odd: the leaf has no readings',
    ]);
  });

  it('treats a non-object file as having no leaves', async () => {
    const fetcher: TextFetcher = { fetchText: () => Promise.resolve('[]') };
    const { problems } = await importLitcal(manifest([{ key: 'a', locator: 'x/en.json#A' }]), REGISTRY, fetcher);
    expect(problems).toEqual(['a ← x/en.json#A: no such leaf in x/en.json']);
  });

  it('needs a pinned revision and a retrieval URL', async () => {
    const { registry } = parseRegistry({
      sources: { litcal: { ...REGISTRY_JSON.sources.litcal, retrieval: undefined } },
    });
    expect(await importLitcal(manifest([]), registry, fakeFetcher())).toEqual({
      readings: [],
      problems: ['sources.json: litcal needs "pinned" and "retrieval"'],
    });
    expect((await importLitcal(manifest([]), { sources: {} }, fakeFetcher())).problems).toHaveLength(1);
  });
});

describe('parseManifest', () => {
  it('accepts a manifest', () => {
    const json = manifest([{ key: 'ot-sunday-25', cycle: 'A', mass: 'day', locator: 'x/en.json#A' }]);
    expect(parseManifest(json, 'm.json')).toEqual({ data: json, problems: [] });
  });

  it('reports problems', () => {
    expect(parseManifest({}, 'm.json').problems).toEqual(['m.json: expected { "target", "kind", "imports": [...] }']);
    expect(
      parseManifest(
        { target: 'x.json', kind: 'saints', imports: [{ key: 'k', locator: 'l', cycle: 'D' }, 'x'] },
        'm.json',
      ).problems,
    ).toEqual([
      'm.json: target must be <block>/<file>.json',
      'm.json: kind must be one of proper-of-time, celebrations, commons',
      'm.json imports[0]: expected { "key", "locator", "mass"?, "cycle"? }',
      'm.json imports[1]: expected { "key", "locator", "mass"?, "cycle"? }',
    ]);
  });
});

describe('mergeImported', () => {
  const olmGospel = reading('gospel', 'Lk 8:16-18', { source: 'olm-1981 p?#449' });

  it('adds new readings, replaces provisional LitCal ones, keeps the rest, and sorts', () => {
    const result = mergeImported(
      {
        kind: 'proper-of-time',
        entries: [
          {
            key: 'ot-weekday-25-mon',
            masses: [{ id: 'day', label: 'Weekday', readings: [olmGospel] }],
          },
          {
            key: 'ot-sunday-25',
            masses: [
              {
                id: 'day',
                readings: [
                  reading('gospel', 'Mt 20:1-15', { cycle: 'A', source: LITCAL }),
                  reading('psalm', 'Ps 145:2-3', { cycle: 'A', source: LITCAL, status: 'verified' }),
                ],
              },
            ],
          },
          { key: 'all-saints', common: 'saints', masses: [] },
        ],
      },
      [
        { key: 'ot-sunday-25', mass: 'day', reading: reading('gospel', 'Mt 20:1-16', { cycle: 'A', source: LITCAL }) },
        { key: 'ot-sunday-25', mass: 'day', reading: reading('psalm', 'Ps 145:2-9', { cycle: 'A', source: LITCAL }) },
        {
          key: 'ot-sunday-25',
          mass: 'day',
          reading: reading('first-reading', 'Is 55:6-9', { cycle: 'A', source: LITCAL }),
        },
        {
          key: 'ot-sunday-25',
          mass: 'day',
          reading: reading('first-reading', 'Is 1:1', { cycle: 'B', source: LITCAL }),
        },
        { key: 'ot-weekday-25-mon', mass: 'day', reading: reading('gospel', 'Lk 8:16-17', { source: LITCAL }) },
        { key: 'ot-sunday-24', mass: 'vigil', reading: reading('gospel', 'Lk 15:1-10', { source: LITCAL }) },
      ],
    );
    expect(result.added).toBe(3);
    expect(result.replaced).toBe(1);
    expect(result.kept).toEqual(['ot-sunday-25 day psalm (A)', 'ot-weekday-25-mon day gospel']);
    expect(result.data.entries.map((e) => e.key)).toEqual([
      'ot-sunday-24',
      'ot-sunday-25',
      'ot-weekday-25-mon',
      'all-saints',
    ]);
    const sunday = result.data.entries[1]?.masses[0]?.readings.map((r) => `${r.slot} ${String(r.cycle)} ${r.ref}`);
    expect(sunday).toEqual([
      'first-reading A Is 55:6-9',
      'first-reading B Is 1:1',
      'psalm A Ps 145:2-3',
      'gospel A Mt 20:1-16',
    ]);
    expect(result.data.entries[2]?.masses[0]).toEqual({ id: 'day', label: 'Weekday', readings: [olmGospel] });
    expect(result.data.entries[3]).toEqual({ key: 'all-saints', common: 'saints', masses: [] });
  });

  it('serialises with an optional comment', () => {
    const data = { kind: 'commons' as const, entries: [] };
    expect(serialiseBlockFile(data)).toBe('{\n  "kind": "commons",\n  "entries": []\n}\n');
    expect(serialiseBlockFile(data, 'note')).toBe(
      '{\n  "$comment": "note",\n  "kind": "commons",\n  "entries": []\n}\n',
    );
  });
});
