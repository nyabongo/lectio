import { describe, expect, it } from 'vitest';

import { OLM } from './fixtures/data.ts';
import { validateBlockFile } from './validate.ts';

const good = {
  $comment: 'ok',
  kind: 'proper-of-time',
  entries: [
    {
      key: 'ot-sunday-26',
      masses: [
        {
          id: 'day',
          label: 'Mass',
          readings: [
            {
              slot: 'second-reading',
              cycle: 'A',
              ref: 'Phil 2:1-11',
              printed: 'Philippians 2:1-11',
              alternatives: [{ ref: 'Phil 2:1-5', printed: 'Philippians 2:1-5' }],
              source: OLM,
              status: 'provisional',
            },
          ],
        },
      ],
    },
  ],
};

describe('validateBlockFile', () => {
  it('accepts a well-formed file', () => {
    const result = validateBlockFile(good, 'seed/x.json');
    expect(result.problems).toEqual([]);
    expect(result.data?.entries[0]?.key).toBe('ot-sunday-26');
  });

  it('rejects a non-object', () => {
    expect(validateBlockFile([], 'f.json')).toEqual({ problems: ['f.json: expected an object { "kind", "entries" }'] });
  });

  it('reports missing and malformed fields with paths', () => {
    const { data, problems } = validateBlockFile(
      {
        kind: 'saints',
        extra: 1,
        entries: [
          'x',
          { masses: 'no' },
          { key: ' padded', common: 3, masses: ['x', { id: 'day', readings: 'none' }, { readings: [] }] },
          {
            key: 'k',
            masses: [
              {
                id: 'day',
                readings: [
                  'x',
                  { slot: 'homily', cycle: 'D', ref: '', source: OLM, status: 'maybe', alternatives: 'x', text: 'no' },
                  { ref: 'Mt 1:1', alternatives: ['x', { printed: 'p' }] },
                ],
              },
            ],
          },
        ],
      },
      'f.json',
    );
    expect(data).toBeUndefined();
    expect(problems).toEqual([
      'f.json: unknown property "extra"',
      'f.json/kind: must be one of proper-of-time, celebrations, commons',
      'f.json/entries/0: must be an object',
      'f.json/entries/1: "key" is required',
      'f.json/entries/1/masses: must be an array',
      'f.json/entries/2/key: must be a non-empty string without surrounding spaces',
      'f.json/entries/2/common: must be a non-empty string without surrounding spaces',
      'f.json/entries/2/masses/0: must be an object',
      'f.json/entries/2/masses/1/readings: must be an array',
      'f.json/entries/2/masses/2: "id" is required',
      'f.json/entries/3/masses/0/readings/0: must be an object',
      'f.json/entries/3/masses/0/readings/1: unknown property "text"',
      'f.json/entries/3/masses/0/readings/1/slot: must be one of ' +
        'first-reading, psalm, second-reading, gospel, reading-1, reading-2, reading-3, reading-4, reading-5, ' +
        'reading-6, reading-7, reading-8, reading-9, psalm-1, psalm-2, psalm-3, psalm-4, psalm-5, psalm-6, psalm-7, ' +
        'psalm-8, psalm-9, epistle',
      'f.json/entries/3/masses/0/readings/1/cycle: must be one of A, B, C, I, II',
      'f.json/entries/3/masses/0/readings/1/ref: must be a non-empty string without surrounding spaces',
      'f.json/entries/3/masses/0/readings/1/status: must be one of provisional, verified, disputed',
      'f.json/entries/3/masses/0/readings/1/alternatives: must be an array',
      'f.json/entries/3/masses/0/readings/2: "slot" is required',
      'f.json/entries/3/masses/0/readings/2: "source" is required',
      'f.json/entries/3/masses/0/readings/2: "status" is required',
      'f.json/entries/3/masses/0/readings/2/alternatives/0: must be an object',
      'f.json/entries/3/masses/0/readings/2/alternatives/1: "ref" is required',
    ]);
  });

  it('requires kind and entries', () => {
    expect(validateBlockFile({}, 'f.json').problems).toEqual([
      'f.json: "kind" is required',
      'f.json: "entries" is required',
    ]);
  });
});
