import { describe, expect, it } from 'vitest';

import { parseRef } from '@lectio/refs';

import { speakable } from '../script/text.ts';
import { SWAHILI_STRINGS, speakSwahiliReferences, swahiliSpokenRef } from './swahili.ts';

describe('swahiliSpokenRef', () => {
  it.each([
    ['Mt 20:1-16a', 'Mathayo sura ya 20, mistari ya 1 hadi 16'],
    ['Mt 20:15', 'Mathayo sura ya 20, mstari wa 15'],
    ['Mt 5', 'Mathayo sura ya 5'],
    ['Mt 5-7', 'Mathayo sura ya 5 hadi ya 7'],
    ['Ps 23', 'Zaburi ya 23'],
    ['Ps 23:1', 'Zaburi ya 23, mstari wa 1'],
    ['Ps 145:2-3, 8-9', 'Zaburi ya 145, mistari ya 2 hadi 3 na 8 hadi 9'],
    ['Ps 120-122', 'Zaburi ya 120 hadi ya 122'],
    ['Jude 3', 'Yuda, mstari wa 3'],
    ['Jude 3, 5, 7', 'Yuda, mistari ya 3, 5 na 7'],
    ['Eccl 11:9-12:8', 'Mhubiri sura ya 11, mstari wa 9 hadi sura ya 12, mstari wa 8'],
    ['Phil 1:20c-24, 27a', 'Wafilipi sura ya 1, mistari ya 20 hadi 24 na 27'],
    ['Gn 2:7-9; 3:1-7', 'Mwanzo sura ya 2, mistari ya 7 hadi 9; sura ya 3, mistari ya 1 hadi 7'],
    ['1 Cor 13:4', 'Wakorintho wa Kwanza sura ya 13, mstari wa 4'],
  ])('says %s', (ref, spoken) => {
    expect(swahiliSpokenRef(parseRef(ref))).toBe(spoken);
  });
});

describe('speakSwahiliReferences', () => {
  it('speaks references written with Kiswahili names and abbreviations', () => {
    expect(speakSwahiliReferences('(Kum 15:9; Mit 28:22)')).toBe(
      '(Kumbukumbu la Torati sura ya 15, mstari wa 9; Mithali sura ya 28, mstari wa 22)',
    );
    expect(speakSwahiliReferences('Mathayo 6:22-23; 7:1 na Mdo. 2:1')).toBe(
      'Mathayo sura ya 6, mistari ya 22 hadi 23; sura ya 7, mstari wa 1 na Matendo ya Mitume sura ya 2, mstari wa 1',
    );
  });

  it('keeps a following numbered book out of the previous reference', () => {
    expect(speakSwahiliReferences('1 Kor 13:4, 1Kor 13:7')).toBe(
      'Wakorintho wa Kwanza sura ya 13, mstari wa 4, Wakorintho wa Kwanza sura ya 13, mstari wa 7',
    );
  });

  it('takes a chapter alone only for a psalm or a one-chapter book', () => {
    expect(speakSwahiliReferences('Zab 23 na Yuda 3')).toBe('Zaburi ya 23 na Yuda, mstari wa 3');
    expect(speakSwahiliReferences('Mwanzo 1 inaanza')).toBe('Mwanzo 1 inaanza');
  });

  it('leaves a trailing part that does not parse as prose, and an unparsable reference as written', () => {
    expect(speakSwahiliReferences('Mathayo 6:22, 21-20 tena')).toBe('Mathayo sura ya 6, mstari wa 22, 21-20 tena');
    expect(speakSwahiliReferences('Mathayo 6:30-29 tena')).toBe('Mathayo 6:30-29 tena');
  });

  it('ignores names inside words and names without a reference', () => {
    expect(speakSwahiliReferences('Mara 3 tu; Mathayo peke yake; 2Mathayo 6:1x')).toBe(
      'Mara 3 tu; Mathayo peke yake; 2Mathayo 6:1x',
    );
  });

  it('takes another spoken form', () => {
    expect(speakSwahiliReferences('Kum 15:9', () => 'REF')).toBe('REF');
  });

  it('leaves standard abbreviations to the shared matcher, which speaks them in Kiswahili', () => {
    const text = speakSwahiliReferences('Katika Is 55:8 na Mit 28:22.');
    expect(speakable(text, [], swahiliSpokenRef)).toBe(
      'Katika Isaya sura ya 55, mstari wa 8 na Mithali sura ya 28, mstari wa 22.',
    );
  });
});

describe('SWAHILI_STRINGS', () => {
  const parts = {
    verse: 'Mathayo sura ya 20, mstari wa 15',
    language: 'Kigiriki',
    translit: 'agathos',
    gloss: 'mwema',
  };

  it('introduces a context segment', () => {
    expect(SWAHILI_STRINGS.contextIntro('Mathayo sura ya 20', 'Shamba la mizabibu')).toBe(
      'Muktadha wa Mathayo sura ya 20. Shamba la mizabibu.',
    );
  });

  it('introduces a note with a word, several words or none', () => {
    expect(SWAHILI_STRINGS.noteIntro({ ...parts, anchor: 'mwema' })).toBe(
      'Maelezo ya tafsiri kuhusu Mathayo sura ya 20, mstari wa 15, neno “mwema”. ' +
        'Kwa Kigiriki ni agathos, maana yake halisi “mwema”.',
    );
    expect(SWAHILI_STRINGS.noteIntro({ ...parts, anchor: 'jicho ovu' })).toContain('maneno “jicho ovu”');
    expect(SWAHILI_STRINGS.noteIntro({ ...parts, anchor: '' })).toBe(
      'Maelezo ya tafsiri kuhusu Mathayo sura ya 20, mstari wa 15. Kwa Kigiriki ni agathos, maana yake halisi “mwema”.',
    );
  });

  it('labels a note with or without its anchor and names the languages', () => {
    expect(SWAHILI_STRINGS.noteTitle('wivu', 'ponēros')).toBe('wivu · ponēros');
    expect(SWAHILI_STRINGS.noteTitle('', 'agathos')).toBe('agathos');
    expect(SWAHILI_STRINGS.languages).toEqual({ grc: 'Kigiriki', hbo: 'Kiebrania', arc: 'Kiaramu', lat: 'Kilatini' });
    expect(SWAHILI_STRINGS.spokenRef).toBe(swahiliSpokenRef);
  });
});
