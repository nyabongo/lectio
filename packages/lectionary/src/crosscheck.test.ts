import { describe, expect, it } from 'vitest';

import { blockRows, crosscheckBlock, parseCrosscheckFile, renderDisputes } from './crosscheck.ts';
import type { CrosscheckEntry, CrosscheckFile } from './crosscheck.ts';
import { LITCAL, REGISTRY, entry, file, reading } from './fixtures/data.ts';

const files = [
  file('proper-of-time', [
    entry('ot-sunday-25', [
      reading('psalm', 'Ps 145:2-3, 8-9, 17-18', { cycle: 'A', source: LITCAL }),
      reading('second-reading', 'Phil 1:20-24, 27', { cycle: 'A', source: LITCAL }),
      reading('gospel', 'Mt 20:1-16', { cycle: 'A', source: LITCAL, alternatives: [{ ref: 'Mt 20:1-8' }] }),
    ]),
    entry('ot-weekday-25-mon', [reading('gospel', 'Lk 8:16-18', { source: 'olm-1981 p?#449' })]),
  ]),
  file('celebrations', [entry('sirach-day', [reading('first-reading', 'Sir 3:2-6', { source: LITCAL })])]),
];

const olm = (slot: string, ref: string, extra: Partial<CrosscheckEntry> = {}): CrosscheckEntry => ({
  kind: 'proper-of-time',
  key: 'ot-sunday-25',
  mass: 'day',
  slot,
  cycle: 'A',
  ref,
  source: 'olm-1981 p?#133',
  ...extra,
});

describe('blockRows', () => {
  it('flattens every reading with a stable id', () => {
    expect(blockRows(files).map((row) => row.id)).toEqual([
      'proper-of-time:ot-sunday-25 day psalm (A)',
      'proper-of-time:ot-sunday-25 day second-reading (A)',
      'proper-of-time:ot-sunday-25 day gospel (A)',
      'proper-of-time:ot-weekday-25-mon day gospel',
      'celebrations:sirach-day day first-reading',
    ]);
  });
});

describe('crosscheckBlock', () => {
  it('agrees after converting Vulgate psalms and dropping letters', () => {
    const crosscheck: CrosscheckFile = {
      block: 'test',
      entries: [
        olm('psalm', 'Ps 144:2-3, 8-9, 17-18'),
        olm('second-reading', 'Phil 1:20c-24, 27a'),
        olm('gospel', 'Mt 20:1-16a', { alternatives: ['Mt 20:1-8'] }),
        {
          kind: 'celebrations',
          key: 'sirach-day',
          mass: 'day',
          slot: 'first-reading',
          ref: 'Sir 3:3-7',
          canonical: 'Sir 3:2-6',
          source: 'olm-1981 p1#1',
        },
      ],
      consulted: [
        { kind: 'proper-of-time', key: 'ot-weekday-25-mon', source: LITCAL, note: 'empty' },
        { kind: 'proper-of-time', key: 'ot-weekday-25-mon', source: 'ke-lect-2020 v3:p1#1' },
        { kind: 'celebrations', key: 'ot-weekday-25-mon', source: 'ignored' },
      ],
    };
    expect(crosscheckBlock('test', files, crosscheck, REGISTRY)).toEqual({
      block: 'test',
      compared: 4,
      agreements: 4,
      disagreements: [],
      singleSource: [
        {
          id: 'proper-of-time:ot-weekday-25-mon day gospel',
          ours: 'Lk 8:16-18',
          source: 'olm-1981 p?#449',
          consulted: [`${LITCAL} (empty)`, 'ke-lect-2020 v3:p1#1'],
        },
      ],
    });
  });

  it('reports every kind of disagreement', () => {
    const crosscheck: CrosscheckFile = {
      block: 'test',
      entries: [
        olm('psalm', 'Ps 145:2-3, 8-9'),
        olm('second-reading', 'Phil 1:20-24', { alternatives: ['Phil 1:20-21'] }),
        olm('gospel', 'Mt 20:1-16'),
        olm('first-reading', 'Is 55:6-9'),
        olm('psalm', 'Ps 1:1', { key: 'ot-weekday-25-mon', cycle: undefined, slot: 'gospel', source: 'usccb p1' }),
        {
          kind: 'celebrations',
          key: 'sirach-day',
          mass: 'day',
          slot: 'first-reading',
          ref: 'Sir 3:2-6',
          source: 'olm-1981 p1#1',
        },
      ],
    };
    const result = crosscheckBlock('test', files, crosscheck, REGISTRY);
    expect(result.compared).toBe(5);
    expect(result.agreements).toBe(0);
    expect(result.singleSource).toEqual([]);
    expect(result.disagreements).toEqual([
      {
        id: 'proper-of-time:ot-sunday-25 day psalm (A)',
        ours: 'Ps 145:2-3, 8-9, 17-18',
        theirs: 'Ps 145:2-3, 8-9',
        reason: 'passage differs: ours PS.145.2-3_145.8-9_145.17-18, theirs PS.146.2-3_146.8-9',
      },
      {
        id: 'proper-of-time:ot-sunday-25 day second-reading (A)',
        ours: 'Phil 1:20-24, 27',
        theirs: 'Phil 1:20-24',
        reason: 'passage differs: ours PHIL.1.20-24_1.27, theirs PHIL.1.20-24',
      },
      {
        id: 'proper-of-time:ot-sunday-25 day gospel (A)',
        ours: 'Mt 20:1-16',
        theirs: 'Mt 20:1-16',
        reason: 'alternatives differ: ours [MT.20.1-8], theirs []',
      },
      {
        id: 'proper-of-time:ot-sunday-25 day first-reading (A)',
        theirs: 'Is 55:6-9',
        reason: 'the block has no such reading',
      },
      {
        id: 'proper-of-time:ot-weekday-25-mon day gospel',
        ours: 'Lk 8:16-18',
        theirs: 'Ps 1:1',
        reason: 'source id "usccb" is not in sources.json',
      },
      {
        id: 'celebrations:sirach-day day first-reading',
        ours: 'Sir 3:2-6',
        theirs: 'Sir 3:2-6',
        reason:
          'cannot convert "Sir 3:2-6" from vulgate: SIR numbering differs entry by entry; give the canonical ref by hand',
      },
    ]);
  });

  it('rejects a second source that is not independent, unparsable refs and bad hand conversions', () => {
    const crosscheck: CrosscheckFile = {
      block: 'test',
      entries: [
        olm('psalm', 'Ps 145:2-3', { source: LITCAL }),
        olm('second-reading', 'Nowhere 1:1'),
        olm('gospel', 'Mt 20:1-16', {
          canonical: 'Mt 20:1-16',
          alternatives: ['Mt 20:1-8'],
          alternativesCanonical: ['Mt 20:1-8a'],
        }),
      ],
    };
    expect(crosscheckBlock('test', files, crosscheck, REGISTRY).disagreements.map((d) => d.reason)).toEqual([
      'not independent: both cite litcal',
      'second-source ref "Nowhere 1:1" does not parse: Unknown book "Nowhere" (in "Nowhere 1:1")',
      'canonical "Mt 20:1-8a" has verse letters; keep them in "printed" only',
    ]);
  });

  it('rejects a second entry for the same reading, so agreements never exceed readings compared', () => {
    const crosscheck: CrosscheckFile = {
      block: 'test',
      entries: [
        olm('psalm', 'Ps 144:2-3, 8-9, 17-18'),
        olm('psalm', 'Ps 144:2-3, 8-9, 17-18'),
        olm('psalm', 'Ps 1:1', { source: 'olm-1981 p2#133' }),
      ],
    };
    const result = crosscheckBlock('test', files, crosscheck, REGISTRY);
    expect(result.compared).toBe(1);
    expect(result.agreements).toBe(1);
    expect(result.disagreements).toEqual([
      {
        id: 'proper-of-time:ot-sunday-25 day psalm (A)',
        ours: 'Ps 145:2-3, 8-9, 17-18',
        theirs: 'Ps 144:2-3, 8-9, 17-18',
        reason: 'duplicate cross-check entry for this reading; keep one',
      },
      {
        id: 'proper-of-time:ot-sunday-25 day psalm (A)',
        ours: 'Ps 145:2-3, 8-9, 17-18',
        theirs: 'Ps 1:1',
        reason: 'duplicate cross-check entry for this reading; keep one',
      },
    ]);
  });
});

describe('parseCrosscheckFile', () => {
  it('accepts a valid file', () => {
    const json = {
      block: 'seed',
      entries: [olm('psalm', 'Ps 1:1')],
      consulted: [{ kind: 'commons', key: 'k', source: 's' }],
    };
    expect(parseCrosscheckFile(json, 'c.json')).toEqual({ data: json, problems: [] });
    expect(parseCrosscheckFile({ block: 'seed', entries: [] }, 'c.json').problems).toEqual([]);
  });

  it('reports problems', () => {
    expect(parseCrosscheckFile({ block: 'x' }, 'c.json').problems).toEqual([
      'c.json: expected { "block", "entries": [...], "consulted"?: [...] }',
    ]);
    expect(
      parseCrosscheckFile(
        {
          block: 'x',
          entries: ['x', { kind: 'saints', key: 1, cycle: 2, alternatives: [3], alternativesCanonical: 'no' }],
          consulted: [{ kind: 'commons' }, { kind: 'commons', key: 'k', source: 's', note: 1 }],
        },
        'c.json',
      ).problems,
    ).toEqual([
      'c.json entries[0]: must be an object',
      'c.json entries[1]: "key" must be a string',
      'c.json entries[1]: "mass" must be a string',
      'c.json entries[1]: "slot" must be a string',
      'c.json entries[1]: "ref" must be a string',
      'c.json entries[1]: "source" must be a string',
      'c.json entries[1]: "kind" must be one of proper-of-time, celebrations, commons',
      'c.json entries[1]: "cycle" must be a string',
      'c.json entries[1]: "alternatives" must be an array of strings',
      'c.json entries[1]: "alternativesCanonical" must be an array of strings',
      'c.json consulted[0]: expected { "kind", "key", "source", "note"? }',
      'c.json consulted[1]: expected { "kind", "key", "source", "note"? }',
    ]);
    expect(parseCrosscheckFile({ block: 'x', entries: [], consulted: {} }, 'c.json').problems).toEqual([
      'c.json: "consulted" must be an array',
    ]);
  });
});

describe('renderDisputes', () => {
  it('renders a clean result', () => {
    const text = renderDisputes({ block: 'b', compared: 0, agreements: 0, disagreements: [], singleSource: [] });
    expect(text).toContain('# Lectionary disputes: block `b`');
    expect(text.match(/^None\.$/gm)).toHaveLength(2);
    expect(text.endsWith('None.\n')).toBe(true);
  });

  it('lists disagreements and groups single-source readings by entry', () => {
    const text = renderDisputes({
      block: 'b',
      compared: 2,
      agreements: 0,
      disagreements: [
        { id: 'proper-of-time:k day gospel', ours: 'Mt 1:1', theirs: 'Mt 1:2', reason: 'passage differs' },
        { id: 'proper-of-time:k day psalm', theirs: 'Ps 1:1', reason: 'the block has no such reading' },
      ],
      singleSource: [
        {
          id: 'celebrations:x day psalm',
          ours: 'Ps 1:1',
          source: 'olm-1981 p?#1',
          consulted: ['litcal@x a/en.json#A'],
        },
        {
          id: 'celebrations:x day gospel',
          ours: 'Mt 1:1',
          source: 'olm-1981 p?#1',
          consulted: ['litcal@x a/en.json#A'],
        },
        { id: 'commons:y day gospel', ours: 'Jn 1:1', source: 'olm-1981 p?#2', consulted: [] },
      ],
    });
    expect(text).toContain(
      '- `proper-of-time:k day gospel`: ours `Mt 1:1`, second source `Mt 1:2`. passage differs.\n' +
        '- `proper-of-time:k day psalm`: ours no reading, second source `Ps 1:1`. the block has no such reading.\n',
    );
    expect(text).toContain(
      '- `celebrations:x`: day psalm `Ps 1:1`; day gospel `Mt 1:1`. Source: `olm-1981 p?#1`. ' +
        'Consulted without result: `litcal@x a/en.json#A`.\n' +
        '- `commons:y`: day gospel `Jn 1:1`. Source: `olm-1981 p?#2`.\n',
    );
  });
});
