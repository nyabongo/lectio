import { describe, expect, it } from 'vitest';

import { OTHER_SHA, REGISTRY, REGISTRY_JSON, SHA } from './fixtures/data.ts';
import { SOURCE_LINE, checkSource, locatorRegExp, parseRegistry, splitSource } from './sources.ts';

describe('source line', () => {
  it('splits id, revision and locator', () => {
    expect(splitSource(`litcal@${SHA} sanctorum/en.json#StMatthewEvangelist`)).toEqual({
      id: 'litcal',
      revision: SHA,
      locator: 'sanctorum/en.json#StMatthewEvangelist',
    });
    expect(splitSource('olm-1981 p97#133')).toEqual({ id: 'olm-1981', locator: 'p97#133' });
  });

  it('rejects lines outside the grammar', () => {
    for (const line of [
      'olm-1981',
      'OLM p97#133',
      'litcal@abc x/en.json#A',
      'olm-1981  p97#133',
      'olm-1981 p97 #133',
    ]) {
      expect(SOURCE_LINE.test(line)).toBe(false);
      expect(splitSource(line)).toBeUndefined();
    }
  });
});

describe('litcal locator grammar (011 fixtures)', () => {
  const litcal = locatorRegExp(REGISTRY.sources['litcal'] as never);
  it.each([
    'dominicale_et_festivum_A/en.json#OrdSunday25',
    'dominicale_et_festivum_A/en.json#Christmas.vigil',
    'feriale_per_annum_II/en.json#OrdWeekday24Monday',
    'sanctorum/en.json#StMatthewEvangelist',
    'decrees/lectionary/en.json#StMaryMagdalene',
  ])('matches %s', (locator) => {
    expect(litcal.test(locator)).toBe(true);
  });
  it.each(['en.json#OrdSunday25', '../en.json#OrdSunday25'])('does not match %s', (locator) => {
    expect(litcal.test(locator)).toBe(false);
  });
});

describe('checkSource', () => {
  it('accepts valid sources', () => {
    expect(checkSource(`litcal@${SHA} sanctorum/en.json#StMatthewEvangelist`, REGISTRY)).toEqual([]);
    expect(checkSource('olm-1981 p97#133', REGISTRY)).toEqual([]);
    expect(checkSource('olm-1981 p?#643', REGISTRY)).toEqual([]);
    expect(checkSource('ke-lect-2020 v3:p412#133', REGISTRY)).toEqual([]);
  });

  it('reports each kind of problem', () => {
    expect(checkSource('nonsense', REGISTRY)[0]).toMatch(/does not match/);
    expect(checkSource('usccb p1#1', REGISTRY)).toEqual(['source id "usccb" is not in sources.json']);
    expect(checkSource('litcal sanctorum/en.json#X', REGISTRY)[0]).toMatch(/need @<revision>/);
    expect(checkSource(`litcal@${OTHER_SHA} sanctorum/en.json#X`, REGISTRY)[0]).toMatch(/not the pinned/);
    expect(checkSource(`olm-1981@${SHA} p97#133`, REGISTRY)[0]).toMatch(/print source/);
    expect(checkSource('olm-1981 97#133', REGISTRY)[0]).toMatch(/locator "97#133" does not match/);
    expect(checkSource(`litcal@${SHA} en.json#OrdSunday25`, REGISTRY)[0]).toMatch(/locator/);
  });

  it('accepts any revision when a versioned source has no pin', () => {
    const { registry } = parseRegistry({
      sources: { litcal: { ...REGISTRY_JSON.sources.litcal, pinned: undefined } },
    });
    expect(checkSource(`litcal@${OTHER_SHA} sanctorum/en.json#X`, registry)).toEqual([]);
  });
});

describe('parseRegistry', () => {
  it('accepts the fixture registry and the committed one', () => {
    expect(parseRegistry(REGISTRY_JSON).problems).toEqual([]);
    expect(Object.keys(REGISTRY.sources)).toEqual(['litcal', 'olm-1981', 'ke-lect-2020']);
  });

  it('rejects a file without sources', () => {
    expect(parseRegistry([]).problems).toEqual(['sources.json: expected { "sources": { <id>: {...} } }']);
    expect(parseRegistry({ sources: [] }).problems).toHaveLength(1);
  });

  it('reports every bad field and leaves bad entries out', () => {
    const { registry, problems } = parseRegistry({
      sources: {
        Bad_Id: 'x',
        broken: {
          title: '',
          convention: 'klingon',
          automatedRetrieval: 'yes',
          physicalCopy: 3,
          permission: 'maybe',
          revision: 'sometimes',
          pinned: 'abc',
          locatorPattern: '(',
        },
        mismatch: { ...REGISTRY_JSON.sources['olm-1981'], locatorExample: 'page 97' },
        nopattern: { ...REGISTRY_JSON.sources['olm-1981'], locatorPattern: undefined },
      },
    });
    expect(registry.sources).toEqual({});
    expect(problems).toEqual([
      'sources.json: id "Bad_Id" must match [a-z0-9-]+',
      'sources.json: Bad_Id must be an object',
      'sources.json: broken: title must be a non-empty string',
      'sources.json: broken: bibliography must be a non-empty string',
      'sources.json: broken: translation must be a non-empty string',
      'sources.json: broken: versification must be a non-empty string',
      'sources.json: broken: psalmNumbering must be a non-empty string',
      'sources.json: broken: licence must be a non-empty string',
      'sources.json: broken: locatorExample must be a non-empty string',
      'sources.json: broken: convention must be one of nabre, vulgate, rsv',
      'sources.json: broken: automatedRetrieval must be a boolean',
      'sources.json: broken: physicalCopy must be a string or null',
      'sources.json: broken: permission must be none-needed, to-request, requested <date> or granted <date> <ref>',
      'sources.json: broken: revision must be "required" or "forbidden"',
      'sources.json: broken: pinned must be a 40-character lower-case git SHA',
      'sources.json: broken: locatorPattern is not a valid regular expression',
      'sources.json: mismatch: locatorExample does not match locatorPattern',
      'sources.json: nopattern: locatorPattern must be a non-empty string',
    ]);
  });

  it('accepts the permission forms of 011', () => {
    for (const permission of ['to-request', 'requested 2026-10-05', 'granted 2026-11-01 letter KCCB/12']) {
      const { problems } = parseRegistry({ sources: { x: { ...REGISTRY_JSON.sources['olm-1981'], permission } } });
      expect(problems).toEqual([]);
    }
  });
});
