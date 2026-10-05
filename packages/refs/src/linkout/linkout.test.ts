import { DEFAULT_CONFIG } from '@lectio/config';
import type { LinkoutConfig, LinkoutProvider } from '@lectio/config';
import { describe, expect, it } from 'vitest';

import * as refs from '../index.ts';
import { parseRef } from '../parse.ts';
import { activeProvider, linkoutUrl } from './linkout.ts';

/** The default config with `extra` providers added and `provider` switched. */
function withProvider(provider: string, extra: Record<string, LinkoutProvider> = {}): { linkout: LinkoutConfig } {
  return {
    linkout: { ...DEFAULT_CONFIG.linkout, provider, providers: { ...DEFAULT_CONFIG.linkout.providers, ...extra } },
  };
}

/** Enables one of the shipped (disabled) template examples. */
function enable(name: 'usccb' | 'universalis'): { linkout: LinkoutConfig } {
  const entry = DEFAULT_CONFIG.linkout.providers[name] as LinkoutProvider;
  return withProvider(name, { [name]: { ...entry, enabled: true } });
}

const READINGS = ['Mt 20:1-16a', 'Ps 145:2-3, 8-9', 'Mal 3:19-20b', 'Jl 3:1-5', 'Is 52:13-53:12', 'Jude 17, 20b-25'];

describe('linkoutUrl with the default drbo provider', () => {
  it('meets the L-007 acceptance examples', () => {
    expect(linkoutUrl('Mt 20:1-16', undefined, DEFAULT_CONFIG)).toEqual({
      provider: 'drbo',
      label: 'Douay-Rheims (drbo.org)',
      url: 'https://www.drbo.org/chapter/47020.htm',
    });
    // Hebrew Ps 145 is Vulgate Ps 144; Hebrew Mal 3:19 is Vulgate Mal 4:1.
    expect(linkoutUrl('Ps 145:2-3', undefined, DEFAULT_CONFIG).url).toBe('https://www.drbo.org/chapter/21144.htm');
    expect(linkoutUrl('Mal 3:19', undefined, DEFAULT_CONFIG).url).toBe('https://www.drbo.org/chapter/44004.htm');
  });

  it('maps other Hebrew/Vulgate differences and keeps the rest', () => {
    expect(linkoutUrl('Jl 3:1-5', undefined, DEFAULT_CONFIG).url).toBe('https://www.drbo.org/chapter/34002.htm');
    expect(linkoutUrl('Ps 23', undefined, DEFAULT_CONFIG).url).toBe('https://www.drbo.org/chapter/21022.htm');
    expect(linkoutUrl('Ps 1:1-2', undefined, DEFAULT_CONFIG).url).toBe('https://www.drbo.org/chapter/21001.htm');
    expect(linkoutUrl('Jude 17, 20b-25', undefined, DEFAULT_CONFIG).url).toBe('https://www.drbo.org/chapter/72001.htm');
  });

  it('links Greek Esther lettered chapters to Vulgate chapters 10-16 (L-049)', () => {
    expect(linkoutUrl('Est C:12, 14-16, 23-25', undefined, DEFAULT_CONFIG).url).toBe(
      'https://www.drbo.org/chapter/19014.htm',
    );
    expect(linkoutUrl('EST.C.12_C.14-16_C.23-25', undefined, DEFAULT_CONFIG).url).toBe(
      'https://www.drbo.org/chapter/19014.htm',
    );
    expect(linkoutUrl('Est A:1-11', undefined, DEFAULT_CONFIG).url).toBe('https://www.drbo.org/chapter/19011.htm');
    expect(linkoutUrl('Est F', undefined, DEFAULT_CONFIG).url).toBe('https://www.drbo.org/chapter/19010.htm');
    expect(linkoutUrl('Est E:1-6', undefined, DEFAULT_CONFIG).url).toBe('https://www.drbo.org/chapter/19016.htm');
    expect(linkoutUrl('Est 4:17', undefined, DEFAULT_CONFIG).url).toBe('https://www.drbo.org/chapter/19004.htm');
  });

  it('links a reference spanning chapters to its first chapter', () => {
    expect(linkoutUrl('Is 52:13-53:12', undefined, DEFAULT_CONFIG).url).toBe('https://www.drbo.org/chapter/27052.htm');
  });

  it('accepts a passage key or a parsed reference', () => {
    expect(linkoutUrl('MT.20.1-16', undefined, DEFAULT_CONFIG).url).toBe('https://www.drbo.org/chapter/47020.htm');
    expect(linkoutUrl(parseRef('Ps 145:2-3'), '2026-10-05', DEFAULT_CONFIG).url).toBe(
      'https://www.drbo.org/chapter/21144.htm',
    );
  });

  it('rejects an invalid reference', () => {
    expect(() => linkoutUrl({ book: 'MT', segments: [] }, undefined, DEFAULT_CONFIG)).toThrow(
      expect.objectContaining({ name: 'RefError' }),
    );
    expect(() => linkoutUrl('Xy 1:1', undefined, DEFAULT_CONFIG)).toThrow(
      expect.objectContaining({ name: 'RefError' }),
    );
  });
});

describe('linkoutUrl with template providers', () => {
  it('switching linkout.provider changes every URL with no code change', () => {
    const custom = withProvider('mysite', {
      mysite: {
        label: 'My Bible site',
        enabled: true,
        template: 'https://example.org/read/{osis}/{chapter}#v{verse}',
        versification: 'vulgate',
      },
    });
    const before = READINGS.map((r) => linkoutUrl(r, '2026-10-05', DEFAULT_CONFIG));
    const after = READINGS.map((r) => linkoutUrl(r, '2026-10-05', custom));
    for (const [i, link] of after.entries()) {
      expect(link.provider).toBe('mysite');
      expect(link.label).toBe('My Bible site');
      expect(link.url).not.toBe(before[i]?.url);
    }
    expect(after.map((l) => l.url)).toEqual([
      'https://example.org/read/Matt/20#v1',
      'https://example.org/read/Ps/144#v2',
      'https://example.org/read/Mal/4#v1',
      'https://example.org/read/Joel/2#v28',
      'https://example.org/read/Isa/52#v13',
      'https://example.org/read/Jude/1#v17',
    ]);
  });

  it('fills the shipped usccb example in the reference numbering (no versification)', () => {
    const config = enable('usccb');
    expect(linkoutUrl('Ps 145:2-3', undefined, config)).toEqual({
      provider: 'usccb',
      label: 'New American Bible (USCCB)',
      url: 'https://bible.usccb.org/bible/psalms/145?2',
    });
    expect(linkoutUrl('1 Cor 12:31-13:13', undefined, config).url).toBe(
      'https://bible.usccb.org/bible/1corinthians/12?31',
    );
    expect(linkoutUrl('Ps 23', undefined, config).url).toBe('https://bible.usccb.org/bible/psalms/23?');
    // The NABRE numbers Esther's additions by letter, and so does the template's {chapter}.
    expect(linkoutUrl('Est C:12, 14-16', undefined, config).url).toBe('https://bible.usccb.org/bible/esther/C?12');
  });

  it('fills the shipped universalis example from the date', () => {
    expect(linkoutUrl('Mt 20:1-16a', '2026-10-05', enable('universalis'))).toEqual({
      provider: 'universalis',
      label: 'Universalis',
      url: 'https://universalis.com/20261005/mass.htm',
    });
  });

  it('needs a valid date for a {date} template', () => {
    const config = enable('universalis');
    expect(() => linkoutUrl('Mt 1:1', undefined, config)).toThrow(expect.objectContaining({ code: 'INVALID_DATE' }));
    expect(() => linkoutUrl('Mt 1:1', '2026-02-30', config)).toThrow(expect.objectContaining({ code: 'INVALID_DATE' }));
  });

  it('maps to the versification a template entry names', () => {
    const config = withProvider('lxx', {
      lxx: {
        label: 'LXX site',
        enabled: true,
        template: 'https://example.org/{usfm}/{chapter}/{verse}',
        versification: 'lxx',
      },
    });
    expect(linkoutUrl('Ps 145:2-3', undefined, config).url).toBe('https://example.org/PSA/144/2');
  });
});

describe('provider errors', () => {
  it('rejects an unknown provider name', () => {
    expect(() => linkoutUrl('Mt 1:1', undefined, withProvider('nope'))).toThrow(
      expect.objectContaining({ name: 'LinkoutError', code: 'UNKNOWN_PROVIDER' }),
    );
    expect(() => linkoutUrl('Mt 1:1', undefined, withProvider('toString'))).toThrow(
      expect.objectContaining({ code: 'UNKNOWN_PROVIDER' }),
    );
  });

  it('rejects a disabled provider', () => {
    expect(() => activeProvider(withProvider('usccb').linkout)).toThrow(
      expect.objectContaining({ code: 'DISABLED_PROVIDER' }),
    );
  });

  it('rejects an entry with both, neither or an unknown builtin', () => {
    const both = { label: 'x', enabled: true, builtin: 'drbo', template: 'https://x.org/' } as const;
    const neither = { label: 'x', enabled: true };
    const unknown = { label: 'x', enabled: true, builtin: 'other' } as unknown as LinkoutProvider;
    for (const entry of [both, neither, unknown]) {
      expect(() => linkoutUrl('Mt 1:1', undefined, withProvider('bad', { bad: entry }))).toThrow(
        expect.objectContaining({ code: 'INVALID_PROVIDER' }),
      );
    }
  });

  it('rejects an unknown versification', () => {
    const config = withProvider('bad', {
      bad: { label: 'x', enabled: true, template: 'https://x.org/{chapter}', versification: 'nova-vulgata' },
    });
    expect(() => linkoutUrl('Mt 1:1', undefined, config)).toThrow(
      expect.objectContaining({ code: 'UNKNOWN_VERSIFICATION' }),
    );
  });

  it('rejects an unknown template token', () => {
    const config = withProvider('bad', { bad: { label: 'x', enabled: true, template: 'https://x.org/{chap}' } });
    expect(() => linkoutUrl('Mt 1:1', undefined, config)).toThrow(expect.objectContaining({ code: 'UNKNOWN_TOKEN' }));
  });
});

describe('package exports', () => {
  it('exposes the builder from @lectio/refs', () => {
    expect(refs.linkoutUrl).toBe(linkoutUrl);
    expect(refs.REFERENCE_SCHEME).toBe('original');
    expect(new refs.LinkoutError('INVALID_URL', 'x')).toBeInstanceOf(Error);
  });
});
