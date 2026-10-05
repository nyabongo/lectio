import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { normaliseGreek, normaliseHebrew, normaliseLatin, normaliserFor, phraseWords } from './normalise.ts';

describe('normaliseGreek', () => {
  it.each([
    ['πονηρός', 'πονηροσ'],
    ['πονηρὸς', 'πονηροσ'],
    ['ΠΟΝΗΡΌΣ', 'πονηροσ'],
    ['πονηρός'.normalize('NFD'), 'πονηροσ'],
    ['ἐγὼ', 'εγω'],
    ['Οὕτως', 'ουτωσ'],
    ['ᾠδῇ', 'ωδη'],
    ['εἰμι;', 'ειμι'],
    ['δι’', 'δι'],
    ["δι'", 'δι'],
    ['ἀπ᾽', 'απ'],
    ['κατʼ', 'κατ'],
    ['⸀λόγος·', 'λογοσ'],
    ['  ὁ   λόγος  ', 'ο λογοσ'],
  ])('%s → %s', (input, expected) => {
    expect(normaliseGreek(input)).toBe(expected);
  });

  it('is idempotent', () => {
    fc.assert(fc.property(fc.string(), (text) => normaliseGreek(normaliseGreek(text)) === normaliseGreek(text)));
  });
});

describe('normaliseHebrew', () => {
  it.each([
    ['בְּ/רֵאשִׁ֖ית', 'בראשית'],
    ['אֱלֹהִ֑ים', 'אלהימ'],
    ['אלהים', 'אלהימ'],
    ['הָ/אָֽרֶץ׃', 'הארצ'],
    ['אֶת־', 'את'],
    ['דֶּ֫רֶךְ', 'דרכ'],
    ['ן ף', 'נ פ'],
    ['שׁ', 'ש'],
    ['פ׀', 'פ'],
  ])('%s → %s', (input, expected) => {
    expect(normaliseHebrew(input)).toBe(expected);
  });

  it('strips every point and accent in U+0591–U+05C7', () => {
    for (let code = 0x0591; code <= 0x05c7; code += 1) {
      expect(normaliseHebrew(`א${String.fromCodePoint(code)}ב`)).toBe('אב');
    }
  });
});

describe('normaliseLatin', () => {
  it.each([
    ['Jesus,', 'iesus'],
    ['Æternus', 'aeternus'],
    ['cœli', 'coeli'],
    ['dixít.', 'dixit'],
    ['Dóminus', 'dominus'],
    ['rosā!', 'rosa'],
  ])('%s → %s', (input, expected) => {
    expect(normaliseLatin(input)).toBe(expected);
  });
});

describe('normaliserFor', () => {
  it('picks the normaliser by language', () => {
    expect(normaliserFor('grc')).toBe(normaliseGreek);
    expect(normaliserFor('hbo')).toBe(normaliseHebrew);
    expect(normaliserFor('arc')).toBe(normaliseHebrew);
    expect(normaliserFor('lat')).toBe(normaliseLatin);
  });
});

describe('phraseWords', () => {
  it('splits at whitespace and maqaf and drops empty words', () => {
    expect(phraseWords('hbo', 'אֶת־הָֽרָקִיעַ֒')).toEqual(['את', 'הרקיע']);
    expect(phraseWords('grc', ' ὁ  ὀφθαλμός , σου ')).toEqual(['ο', 'οφθαλμοσ', 'σου']);
    expect(phraseWords('lat', '. ,')).toEqual([]);
  });
});
