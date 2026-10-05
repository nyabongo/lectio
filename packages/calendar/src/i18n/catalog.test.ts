import { describe, expect, it } from 'vitest';

import { catalogProblems, parseNameCatalog } from './catalog.ts';

const entry = (name: string) => ({ name, status: 'provisional' });

function validCatalog(): Record<string, unknown> {
  return {
    locale: 'sw',
    language: 'Kiswahili',
    description: 'test',
    sources: [],
    seasons: {
      advent: entry('Majilio'),
      christmas: entry('Noeli'),
      'ordinary-time': entry('Mwaka'),
      lent: entry('Kwaresima'),
      'paschal-triduum': entry('Siku Tatu Kuu'),
      easter: entry('Pasaka'),
    },
    colours: {
      white: entry('Nyeupe'),
      red: entry('Nyekundu'),
      green: entry('Kijani'),
      violet: entry('Zambarau'),
      rose: entry('Waridi'),
      black: entry('Nyeusi'),
      gold: { name: 'Dhahabu', status: 'reviewed', note: 'checked' },
    },
    celebrations: {
      'easter-sunday': entry('Pasaka'),
      'saint-nobody': { name: null, status: 'fallback', note: 'no established name' },
    },
  };
}

describe('catalogProblems', () => {
  it('accepts a valid catalog', () => {
    expect(catalogProblems(validCatalog())).toEqual([]);
  });

  it('rejects a value that is not an object', () => {
    expect(catalogProblems([])).toEqual(['catalog: must be an object']);
    expect(catalogProblems(null)).toEqual(['catalog: must be an object']);
  });

  it('reports top-level problems', () => {
    const catalog = { ...validCatalog(), locale: 'Swahili', language: ' ', extra: 1, celebrations: [] };
    expect(catalogProblems(catalog)).toEqual([
      'catalog: unknown key "extra"',
      'locale: must be a language tag such as "sw"',
      'language: must be a non-empty string',
      'celebrations: must be an object',
    ]);
    expect(catalogProblems({ ...validCatalog(), locale: 7 })).toEqual(['locale: must be a language tag such as "sw"']);
  });

  it('requires exactly the seasons and colours of the schema', () => {
    const catalog = validCatalog();
    const seasons: Record<string, unknown> = {
      ...(catalog['seasons'] as Record<string, unknown>),
      summer: entry('Kiangazi'),
    };
    delete seasons['lent'];
    expect(catalogProblems({ ...catalog, seasons, colours: 'none' })).toEqual([
      'seasons.lent: missing',
      'seasons: unknown key "summer"',
      'colours: must be an object',
    ]);
  });

  it('checks every entry', () => {
    const celebrations = {
      'not an id': entry('x'),
      'no-object': 'Pasaka',
      'bad-status': { name: 'x', status: 'draft' },
      'empty-name': { name: '', status: 'provisional' },
      'null-name': { name: null, status: 'reviewed' },
      'named-fallback': { name: 'x', status: 'fallback' },
      'bad-note': { name: 'x', status: 'provisional', note: '' },
      'extra-key': { name: 'x', status: 'provisional', sw: 'x' },
    };
    expect(catalogProblems({ ...validCatalog(), celebrations })).toEqual([
      'celebrations: "not an id" is not a celebration id',
      'celebrations.no-object: must be an object with name and status',
      'celebrations.bad-status.status: must be one of provisional, reviewed, fallback',
      'celebrations.empty-name.name: must be a non-empty string (use status "fallback" with name null when there is none)',
      'celebrations.null-name.name: must be a non-empty string (use status "fallback" with name null when there is none)',
      'celebrations.named-fallback.name: must be null for a fallback',
      'celebrations.bad-note.note: must be a non-empty string',
      'celebrations.extra-key: unknown key "sw"',
    ]);
  });
});

describe('parseNameCatalog', () => {
  it('returns a valid catalog unchanged', () => {
    const catalog = validCatalog();
    expect(parseNameCatalog(catalog)).toBe(catalog);
  });

  it('throws with every problem and the source', () => {
    expect(() => parseNameCatalog({ ...validCatalog(), language: '' }, 'calendar/i18n/xx.json')).toThrow(
      'Invalid calendar/i18n/xx.json:\n  language: must be a non-empty string',
    );
    expect(() => parseNameCatalog(1)).toThrow('Invalid name catalog:\n  catalog: must be an object');
  });
});
