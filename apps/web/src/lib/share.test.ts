import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import {
  INSIGHT_MAX_LENGTH,
  REF_MAX_LENGTH,
  buildShareText,
  cleanShareUrl,
  copyText,
  dayShareInsight,
  mailtoUrl,
  nativeShare,
  oneLine,
  parseShareConfig,
  shareConfig,
  shareLines,
  truncate,
  whatsappUrl,
} from './share.ts';
import type { ShareTextInput } from './share.ts';

interface Vectors {
  readonly limits: { readonly ref: number; readonly insight: number };
  readonly vectors: readonly { readonly name: string; readonly input: ShareTextInput; readonly expected: string }[];
  readonly invalid: readonly { readonly name: string; readonly input: ShareTextInput }[];
}

const vectors = JSON.parse(
  readFileSync(new URL('../../../../packages/schema/fixtures/share-text.json', import.meta.url), 'utf8'),
) as Vectors;

const URL_ = 'https://nyabongo.github.io/lectio/2026-09-20/gospel/';

describe('share text vectors (packages/schema/fixtures/share-text.json)', () => {
  it('states the same limits as the code', () => {
    expect(vectors.limits).toEqual({ ref: REF_MAX_LENGTH, insight: INSIGHT_MAX_LENGTH });
  });

  it.each(vectors.vectors.map((vector) => [vector.name, vector] as const))('%s', (_name, { input, expected }) => {
    expect(buildShareText(input)).toBe(expected);
  });

  it.each(vectors.invalid.map((vector) => [vector.name, vector] as const))('%s throws', (_name, { input }) => {
    expect(() => buildShareText(input)).toThrow(RangeError);
  });

  it('never carries a query string, and keeps every line within its limit', () => {
    for (const { expected } of vectors.vectors) {
      const lines = expected.split('\n');
      const url = lines.at(-1) ?? '';
      expect(new URL(url).search).toBe('');
      expect(url).not.toMatch(/utm_|fbclid|gclid/);
      expect([...(lines[0] ?? '')].length).toBeLessThanOrEqual(REF_MAX_LENGTH);
      if (lines.length === 3) expect([...(lines[1] ?? '')].length).toBeLessThanOrEqual(INSIGHT_MAX_LENGTH);
    }
  });
});

describe('oneLine and truncate', () => {
  it('collapses whitespace', () => {
    expect(oneLine('  a\n\tb  c ')).toBe('a b c');
  });

  it('leaves short text alone and cuts long text with an ellipsis', () => {
    expect(truncate('short', 10)).toBe('short');
    expect(truncate('exactly ten', 11)).toBe('exactly ten');
    expect(truncate('one two three four', 12)).toBe('one two…');
    expect(truncate('one two, three', 10)).toBe('one two…');
    expect(truncate('abcdefghijkl', 6)).toBe('abcde…');
    expect(truncate('.........', 5)).toBe('…');
  });
});

describe('cleanShareUrl', () => {
  it('drops the query string and keeps the fragment', () => {
    expect(cleanShareUrl(`${URL_}?utm_source=x#note`)).toBe(`${URL_}#note`);
    expect(cleanShareUrl('http://localhost:4329/lectio/')).toBe('http://localhost:4329/lectio/');
  });

  it('rejects relative and non-http URLs', () => {
    expect(() => cleanShareUrl('/lectio/')).toThrow(/absolute/);
    expect(() => cleanShareUrl('mailto:a@b.c')).toThrow(/http or https/);
  });
});

describe('shareLines and shareConfig', () => {
  it('needs a reference', () => {
    expect(() => shareLines({ ref: '', insight: 'x' })).toThrow(/reference/);
  });

  it('builds the native payload without the link in its text, and the fallback text with it', () => {
    const config = shareConfig({
      title: ' Mt 20:1-16a ·\n Gospel ',
      ref: 'Mt 20:1-16a',
      insight: 'A landowner pays the last hired the same as the first.',
      url: `${URL_}?fbclid=1`,
    });
    expect(config).toEqual({
      payload: {
        title: 'Mt 20:1-16a · Gospel',
        text: 'Mt 20:1-16a\nA landowner pays the last hired the same as the first.',
        url: URL_,
      },
      text: `Mt 20:1-16a\nA landowner pays the last hired the same as the first.\n${URL_}`,
    });
  });
});

describe('share links', () => {
  it('encodes the text for WhatsApp and email', () => {
    expect(whatsappUrl('Mt 20 & more\nhttps://x/?a=1')).toBe(
      'https://wa.me/?text=Mt%2020%20%26%20more%0Ahttps%3A%2F%2Fx%2F%3Fa%3D1',
    );
    expect(mailtoUrl('A & B', 'line\nnext')).toBe('mailto:?subject=A%20%26%20B&body=line%0Anext');
  });
});

describe('dayShareInsight', () => {
  const reading = (slot: string, summary: string | null) => ({ slot, summary });

  it('prefers the Gospel, then the first summary, then nothing', () => {
    expect(
      dayShareInsight({ masses: [{ readings: [reading('first', 'First.'), reading('gospel', 'Gospel.')] }] }),
    ).toBe('Gospel.');
    expect(
      dayShareInsight({ masses: [{ readings: [reading('first', null)] }, { readings: [reading('psalm', 'Psalm.')] }] }),
    ).toBe('Psalm.');
    expect(dayShareInsight({ masses: [{ readings: [reading('gospel', null)] }] })).toBeNull();
    expect(dayShareInsight({ masses: [] })).toBeNull();
  });
});

describe('nativeShare', () => {
  const payload = { title: 't', text: 'x', url: URL_ };

  it('falls back without Web Share or when the payload is refused', async () => {
    expect(await nativeShare({}, payload)).toBe('fallback');
    const share = vi.fn(() => Promise.resolve());
    expect(await nativeShare({ share, canShare: () => false }, payload)).toBe('fallback');
    expect(share).not.toHaveBeenCalled();
  });

  it('shares the payload', async () => {
    const share = vi.fn(() => Promise.resolve());
    expect(await nativeShare({ share, canShare: () => true }, payload)).toBe('shared');
    expect(await nativeShare({ share }, payload)).toBe('shared');
    expect(share).toHaveBeenCalledWith(payload);
  });

  it('treats an AbortError as cancelled and any other failure as a fallback', async () => {
    const abort = Object.assign(new Error('closed'), { name: 'AbortError' });
    expect(await nativeShare({ share: () => Promise.reject(abort) }, payload)).toBe('cancelled');
    expect(await nativeShare({ share: () => Promise.reject(new Error('NotAllowed')) }, payload)).toBe('fallback');
    expect(await nativeShare({ share: () => Promise.reject(new Error('x')) }, payload)).toBe('fallback');
    expect(await nativeShare({ share: () => Promise.reject('AbortError') }, payload)).toBe('fallback');
  });
});

describe('copyText', () => {
  it('uses the Clipboard API first', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    const legacyCopy = vi.fn(() => true);
    expect(await copyText({ clipboard: { writeText }, legacyCopy }, 'hi')).toBe(true);
    expect(writeText).toHaveBeenCalledWith('hi');
    expect(legacyCopy).not.toHaveBeenCalled();
  });

  it('falls back to the legacy path when the Clipboard API fails or is missing', async () => {
    const legacyCopy = vi.fn(() => true);
    expect(
      await copyText({ clipboard: { writeText: () => Promise.reject(new Error('denied')) }, legacyCopy }, 'a'),
    ).toBe(true);
    expect(await copyText({ legacyCopy }, 'b')).toBe(true);
    expect(legacyCopy.mock.calls).toEqual([['a'], ['b']]);
  });

  it('reports failure when nothing can copy', async () => {
    expect(await copyText({}, 'x')).toBe(false);
    expect(await copyText({ legacyCopy: () => false }, 'x')).toBe(false);
    expect(
      await copyText(
        {
          legacyCopy: () => {
            throw new Error('SecurityError');
          },
        },
        'x',
      ),
    ).toBe(false);
  });
});

describe('parseShareConfig', () => {
  const config = shareConfig({ title: 'T', ref: 'R', insight: null, url: URL_ });

  it('round-trips the rendered JSON', () => {
    expect(parseShareConfig(JSON.stringify(config))).toEqual(config);
  });

  it.each([
    ['missing', undefined],
    ['malformed', '{'],
    ['null', 'null'],
    ['no text', JSON.stringify({ payload: config.payload })],
    ['no payload', JSON.stringify({ text: 'x' })],
    ['bad payload', JSON.stringify({ text: 'x', payload: { title: 'T', text: 1, url: URL_ } })],
    ['no url', JSON.stringify({ text: 'x', payload: { title: 'T', text: 'x' } })],
  ])('returns null when %s', (_name, json) => {
    expect(parseShareConfig(json)).toBeNull();
  });
});
