import { describe, expect, it } from 'vitest';

import { ProviderError } from '@lectio/providers';

import { buildSsml, escapeXml, stripInvalidXmlChars, voiceLocale } from './ssml.ts';

describe('escapeXml', () => {
  it('escapes the five XML special characters', () => {
    expect(escapeXml(`Tom & Jerry <say> "hi" it's`)).toBe('Tom &amp; Jerry &lt;say&gt; &quot;hi&quot; it&apos;s');
  });

  it('does not double-escape and drops characters XML forbids', () => {
    expect(escapeXml('&amp;\u0000\u0007ok\t\n￿')).toBe('&amp;amp;ok\t\n');
  });
});

describe('stripInvalidXmlChars', () => {
  it('keeps tab, newline, carriage return and ordinary Unicode', () => {
    expect(stripInvalidXmlChars('a\u0001\tb\r\nç\u000B𝔸')).toBe('a\tb\r\nç𝔸');
  });
});

describe('voiceLocale', () => {
  it('derives the locale from an Azure voice name', () => {
    expect(voiceLocale('en-KE-AsiliaNeural')).toBe('en-KE');
    expect(voiceLocale('sw-KE-ZuriNeural')).toBe('sw-KE');
    expect(voiceLocale('fil-PH-BlessicaNeural')).toBe('fil-PH');
    expect(voiceLocale('en-US-AvaMultilingualNeural-HD')).toBe('en-US');
    expect(voiceLocale('sr-Latn-RS-NicholasNeural')).toBe('sr-Latn-RS');
    expect(voiceLocale('iu-Cans-CA-SiqiniqNeural')).toBe('iu-Cans-CA');
  });

  it('rejects names that are not Azure voices', () => {
    for (const voice of [
      '',
      'Asilia',
      'en-ke-Asilia',
      'en-KE-',
      'en-KE-x"y',
      'sr-latn-RS-NicholasNeural',
      'sr-Latn-NicholasNeural',
    ]) {
      const error = (() => {
        try {
          voiceLocale(voice);
        } catch (thrown) {
          return thrown;
        }
        return undefined;
      })();
      expect(error).toBeInstanceOf(ProviderError);
      expect((error as ProviderError).code).toBe('invalid-request');
    }
  });
});

describe('buildSsml', () => {
  it('wraps escaped text in speak and voice elements', () => {
    expect(buildSsml('Peace <be> with you & yours', 'en-KE-AsiliaNeural')).toBe(
      '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-KE">' +
        '<voice name="en-KE-AsiliaNeural">Peace &lt;be&gt; with you &amp; yours</voice></speak>',
    );
  });

  it('cannot be broken out of with markup in the text', () => {
    const ssml = buildSsml('</voice><voice name="evil">x', 'sw-KE-ZuriNeural');
    expect(ssml.match(/<voice /g)).toHaveLength(1);
    expect(ssml).toContain('&lt;/voice&gt;&lt;voice name=&quot;evil&quot;&gt;x');
  });
});
