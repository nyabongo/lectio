import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { normaliseGreek, normaliseHebrew, normaliseLatin, normaliserFor, phraseWords, tokenForms } from './normalise.ts';

describe('normaliseGreek', () => {
  it.each([
    ['πονηρός', 'πονηροσ'],
    ['πονηρὸς', 'πονηροσ'],
    ['ΠΟΝΗΡΌΣ', 'πονηροσ'],
    ['πονηρός'.normalize('NFD'), 'πονηροσ'],
    ['ἐγὼ', 'εγω'],
    ['Οὕτως', 'ουτωσ'],
    ['λόγοϲ', 'λογοσ'],
    ['ΛΟΓΟϹ', 'λογοσ'],
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
    ['cǽlum', 'caelum'],
    ['Ǽternus', 'aeternus'],
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

describe('tokenForms', () => {
  it('gives every run of OSHB "/" segments that ends with the last segment, for Hebrew and Aramaic', () => {
    expect(tokenForms('hbo', 'וְ/רָעָ֣ה')).toEqual(['ורעה', 'רעה']);
    expect(tokenForms('arc', 'a/b/c')).toEqual(['abc', 'bc', 'c']);
    expect(tokenForms('hbo', 'd/8064', 'lemma')).toEqual(['d8064', '8064']);
    expect(tokenForms('hbo', 'ברא')).toEqual(['ברא']);
  });

  it('never gives a bare prefix or a prefix run on its own', () => {
    expect(tokenForms('hbo', 'הַ/שָּׁמַ֖יִם')).not.toContain('ה');
    expect(tokenForms('hbo', 'd/8064', 'lemma')).not.toContain('d');
    expect(tokenForms('arc', 'a/b/c')).not.toContain('ab');
    expect(tokenForms('arc', 'a/b/c')).not.toContain('b');
  });

  it("adds the bare Strong's number for a lemma with a homograph letter", () => {
    expect(tokenForms('hbo', '1254 a', 'lemma')).toEqual(['1254 a', '1254']);
    expect(tokenForms('hbo', 'c/6213 a', 'lemma')).toEqual(['c6213 a', '6213 a', 'c6213', '6213']);
    expect(tokenForms('arc', '1234b', 'lemma')).toEqual(['1234b', '1234']);
    expect(tokenForms('hbo', '1254 a')).toEqual(['1254 a']);
    expect(tokenForms('hbo', '1254 ab', 'lemma')).toEqual(['1254 ab']);
    expect(tokenForms('hbo', 'a/1254', 'lemma')).toEqual(['a1254', '1254']);
    expect(tokenForms('hbo', '', 'lemma')).toEqual([]);
  });

  it('keeps one form for other languages and none for empty tokens', () => {
    expect(tokenForms('grc', 'πονηρός')).toEqual(['πονηροσ']);
    expect(tokenForms('lat', 'a/b')).toEqual(['ab']);
    expect(tokenForms('hbo', '')).toEqual([]);
    expect(tokenForms('hbo', '/׃')).toEqual([]);
  });
});
