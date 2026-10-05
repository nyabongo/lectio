import { readFileSync } from 'node:fs';

import { GeneralRoman_En } from '@romcal/calendar.general-roman';
import { Romcal } from 'romcal';
import { describe, expect, it } from 'vitest';

import { ROMCAL_ID_ALIASES, toLectioId } from './ids.ts';

const snapshot = JSON.parse(readFileSync(new URL('./fixtures/romcal-ids.json', import.meta.url), 'utf8')) as Record<
  string,
  string
>;

async function romcalIds(): Promise<string[]> {
  const ids = new Set<string>();
  for (const onSunday of [false, true]) {
    const romcal = new Romcal({
      localizedCalendar: GeneralRoman_En,
      epiphanyOnSunday: onSunday,
      ascensionOnSunday: onSunday,
      corpusChristiOnSunday: onSunday,
    });
    for (const id of Object.keys(await romcal.getAllDefinitions())) ids.add(id);
  }
  return [...ids].sort();
}

describe('toLectioId', () => {
  it('kebab-cases romcal ids', () => {
    expect(toLectioId('matthew_apostle')).toBe('matthew-apostle');
    expect(toLectioId('ordinary_time_25_sunday')).toBe('ordinary-time-25-sunday');
  });

  it('applies aliases', () => {
    expect(toLectioId('loreto')).toBe('our-lady-of-loreto');
    expect(toLectioId('cyril_constantine_the_philosopher_monk_and_methodius_michael_of_thessaloniki_bishop')).toBe(
      'cyril-monk-and-methodius-bishop',
    );
  });

  it('ignores inherited object keys', () => {
    expect(toLectioId('constructor')).toBe('constructor');
  });

  it('rejects ids that are not slugs or are too long', () => {
    expect(() => toLectioId('Bad_Id')).toThrow(/ROMCAL_ID_ALIASES/);
    expect(() => toLectioId('a__b')).toThrow(/not a slug/);
    expect(() => toLectioId('x'.repeat(65))).toThrow(/at most 64/);
    expect(toLectioId('x'.repeat(64))).toHaveLength(64);
  });

  it('keeps every alias a valid, distinct slug', () => {
    const values = Object.keys(ROMCAL_ID_ALIASES).map(toLectioId);
    expect(new Set(values).size).toBe(values.length);
  });
});

describe('stable ids against romcal', () => {
  it('maps every romcal liturgical day exactly as the committed snapshot (renames need an alias)', async () => {
    const ids = await romcalIds();
    expect(ids).toEqual(Object.keys(snapshot).sort());
    expect(Object.fromEntries(ids.map((id) => [id, toLectioId(id)]))).toEqual(snapshot);
  });

  it('never maps two romcal ids to the same Lectio id', () => {
    const values = Object.values(snapshot);
    expect(new Set(values).size).toBe(values.length);
  });
});
