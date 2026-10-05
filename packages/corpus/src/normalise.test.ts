import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  lemmaKey,
  normaliseGreek,
  normaliseHebrew,
  normaliseLatin,
  normaliserFor,
  phraseWords,
  tokenForms,
} from './normalise.ts';

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

  it("joins a Strong's number and a following lone letter into one lemmaKey word in Hebrew and Aramaic", () => {
    expect(phraseWords('hbo', '7225 1254 a 430')).toEqual(['7225', '1254a', '430']);
    expect(phraseWords('hbo', 'c/6213 A')).toEqual(['c6213a']);
    expect(phraseWords('hbo', '1254 a b')).toEqual(['1254a', 'b']);
    expect(phraseWords('hbo', 'a 1254')).toEqual(['a', '1254']);
    expect(phraseWords('arc', '3046 a')).toEqual(['3046a']);
    expect(phraseWords('lat', 'et a deo')).toEqual(['et', 'a', 'deo']);
  });

  it('keeps a number and a following letter apart in other languages', () => {
    expect(phraseWords('lat', '1 a')).toEqual(['1', 'a']);
    expect(phraseWords('grc', '2 b')).toEqual(['2', 'b']);
  });
});

describe('lemmaKey', () => {
  it('joins and lower-cases a homograph letter and leaves other words alone', () => {
    expect(lemmaKey('1254 a')).toBe('1254a');
    expect(lemmaKey('1254A')).toBe('1254a');
    expect(lemmaKey('c6213 a')).toBe('c6213a');
    expect(lemmaKey('1254')).toBe('1254');
    expect(lemmaKey('1254 ab')).toBe('1254 ab');
    expect(lemmaKey('d')).toBe('d');
    expect(lemmaKey('שמים')).toBe('שמים');
  });
});

describe('tokenForms', () => {
  it('without a morph, gives every run of OSHB "/" segments that ends with the last segment', () => {
    expect(tokenForms('hbo', 'וְ/רָעָ֣ה')).toEqual(['ורעה', 'רעה']);
    expect(tokenForms('arc', 'a/b/c')).toEqual(['abc', 'bc', 'c']);
    expect(tokenForms('hbo', 'ברא')).toEqual(['ברא']);
    expect(tokenForms('hbo', 'הַ/שָּׁמַ֖יִם')).not.toContain('ה');
  });

  it('uses the morph to find the stem and gives every run that contains it', () => {
    expect(tokenForms('hbo', 'לְ/מִינ֔/וֹ', { morph: 'HR/Ncmsc/Sp3ms' })).toEqual(['למינ', 'למינו', 'מינ', 'מינו']);
    expect(tokenForms('hbo', 'זַרְע/וֹ', { morph: 'HNcmsc/Sp3ms' })).toEqual(['זרע', 'זרעו']);
    expect(tokenForms('hbo', 'ב֖/וֹ', { morph: 'HR/Sp3ms' })).toEqual(['ב', 'בו']);
    expect(tokenForms('hbo', 'הַ/שָּׁמַ֖יִם', { morph: 'HTd/Ncmpa' })).toEqual(['השמימ', 'שמימ']);
    expect(tokenForms('hbo', 'וְ/הָ/אָ֗רֶץ', { morph: 'HC/Td/Ncbsa' })).toEqual(['והארצ', 'הארצ', 'ארצ']);
    expect(tokenForms('arc', 'וּ/פִשְׁרָ֥/א', { morph: 'AC/Ncmsd/Td' })).toEqual(['ופשר', 'ופשרא', 'פשר', 'פשרא']);
    expect(tokenForms('arc', 'a/b/c/d', { morph: 'AC/Ncmpc/Sp2ms/Sh' })).toEqual([
      'ab',
      'abc',
      'abcd',
      'b',
      'bc',
      'bcd',
    ]);
  });

  it('falls back to the last segment when the morph segment count differs, and ignores it elsewhere', () => {
    expect(tokenForms('hbo', 'בְּ/אָחִ֙יךָ֙', { morph: 'HR/Ncmsc/Sp2ms' })).toEqual(['באחיכ', 'אחיכ']);
    expect(tokenForms('hbo', 'a/b', { morph: '' })).toEqual(['ab', 'b']);
    expect(tokenForms('lat', 'a/b', { morph: 'S' })).toEqual(['ab']);
    expect(tokenForms('hbo', 'd/8064', { field: 'lemma', morph: 'HTd/Ncmpa/Sp3ms' })).toEqual(['d8064', '8064']);
  });

  it('never gives a bare prefix or a bare suffix', () => {
    const forms = tokenForms('hbo', 'לְ/מִינ֔/וֹ', { morph: 'HR/Ncmsc/Sp3ms' });
    expect(forms).not.toContain('ל');
    expect(forms).not.toContain('ו');
    expect(tokenForms('arc', 'מַלְכָּ/א֙', { morph: 'ANcmsd/Td' })).toEqual(['מלכ', 'מלכא']);
    expect(tokenForms('hbo', 'd/8064', { field: 'lemma' })).toEqual(['d8064', '8064']);
  });

  it("gives lemmas in lemmaKey spelling, plus the bare Strong's number for a homograph letter", () => {
    expect(tokenForms('hbo', '1254 a', { field: 'lemma' })).toEqual(['1254a', '1254']);
    expect(tokenForms('hbo', 'c/6213 a', { field: 'lemma' })).toEqual(['c6213a', '6213a', 'c6213', '6213']);
    expect(tokenForms('arc', '1234B', { field: 'lemma' })).toEqual(['1234b', '1234']);
    expect(tokenForms('hbo', '1254 a')).toEqual(['1254 a']);
    expect(tokenForms('hbo', '1254 ab', { field: 'lemma' })).toEqual(['1254 ab']);
    expect(tokenForms('hbo', 'a/1254', { field: 'lemma' })).toEqual(['a1254', '1254']);
    expect(tokenForms('hbo', '', { field: 'lemma' })).toEqual([]);
  });

  it('keeps one form for other languages and none for empty tokens', () => {
    expect(tokenForms('grc', 'πονηρός')).toEqual(['πονηροσ']);
    expect(tokenForms('lat', 'a/b')).toEqual(['ab']);
    expect(tokenForms('hbo', '')).toEqual([]);
    expect(tokenForms('hbo', '/׃')).toEqual([]);
  });
});
