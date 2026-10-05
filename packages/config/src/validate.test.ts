import { describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG } from './defaults.ts';
import { deepMerge } from './merge.ts';
import { ConfigError, pointerSegment, validateConfig } from './validate.ts';
import type { ConfigIssue } from './validate.ts';

function issuesFor(override: unknown): readonly ConfigIssue[] {
  try {
    validateConfig(deepMerge(DEFAULT_CONFIG, override), 'test.json');
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigError);
    return (error as ConfigError).issues;
  }
  throw new Error('expected the config to be rejected');
}

describe('validateConfig', () => {
  it('accepts the defaults and returns them', () => {
    expect(validateConfig(structuredClone(DEFAULT_CONFIG))).toEqual(DEFAULT_CONFIG);
  });

  it('rejects verifiers from the same family with an explanation', () => {
    const issues = issuesFor({ verifiers: { refuter: { family: 'anthropic', model: 'claude-haiku-4-5' } } });
    expect(issues).toHaveLength(1);
    expect(issues[0]?.pointer).toBe('/verifiers/refuter/family');
    expect(issues[0]?.message).toMatch(/different model families \(both are "anthropic"\)/);
    expect(issues[0]?.message).toMatch(/independent/);
  });

  it('reports type errors, unknown keys and missing keys with JSON pointers', () => {
    const issues = issuesFor({
      site: { locales: ['en', 5], extra: 1 },
      autoMerge: { minSupport: 1.5 },
      runway: { windowDays: 'soon' },
    });
    expect(issues).toEqual(
      expect.arrayContaining([
        { pointer: '/site/locales/1', message: 'must be string' },
        { pointer: '/site/extra', message: 'unknown key' },
        { pointer: '/autoMerge/minSupport', message: 'must be <= 1' },
        { pointer: '/runway/windowDays', message: 'must be integer' },
      ]),
    );
  });

  it('reports a missing key', () => {
    const config = structuredClone(DEFAULT_CONFIG) as unknown as { site: Record<string, unknown> };
    delete config.site.timezone;
    expect(() => validateConfig(config)).toThrow(/\/site\/timezone: is required/);
  });

  it('lists the allowed values for an enum', () => {
    expect(issuesFor({ verifiers: { mode: 'sometimes' } })).toEqual([
      { pointer: '/verifiers/mode', message: 'must be one of "auto", "live", "fake", "skip"' },
    ]);
  });

  it('rejects bad map keys and escapes them in the pointer', () => {
    expect(
      issuesFor({ linkout: { providers: { 'Bad/Key': { label: 'x', enabled: false, template: 'https://x' } } } }),
    ).toEqual(expect.arrayContaining([{ pointer: '/linkout/providers/Bad~1Key', message: 'invalid key name' }]));
  });

  it('rejects a non-object file at the root', () => {
    expect(() => validateConfig([], 'list.json')).toThrow('Invalid Lectio config (list.json):\n  /: must be object');
  });

  it('rejects a default locale missing from the locales', () => {
    expect(issuesFor({ site: { defaultLocale: 'sw' } })).toEqual([
      { pointer: '/site/defaultLocale', message: '"sw" is not listed in site.locales' },
    ]);
  });

  it('rejects an unknown or disabled link-out provider', () => {
    expect(issuesFor({ linkout: { provider: 'nope' } })).toEqual([
      { pointer: '/linkout/provider', message: '"nope" is not in linkout.providers (drbo, usccb, universalis)' },
    ]);
    expect(issuesFor({ linkout: { provider: 'usccb' } })).toEqual([
      { pointer: '/linkout/provider', message: '"usccb" is disabled; set its enabled: true' },
    ]);
  });

  it('accepts switching to an enabled template provider', () => {
    const config = validateConfig(
      deepMerge(DEFAULT_CONFIG, { linkout: { provider: 'usccb', providers: { usccb: { enabled: true } } } }),
    );
    expect(config.linkout.provider).toBe('usccb');
  });

  it('requires exactly one of builtin or template', () => {
    expect(
      issuesFor({
        linkout: { providers: { both: { label: 'x', enabled: false, builtin: 'drbo', template: 'https://x' } } },
      }),
    ).toEqual([{ pointer: '/linkout/providers/both', message: 'set exactly one of "builtin" or "template"' }]);
    expect(issuesFor({ linkout: { providers: { neither: { label: 'x', enabled: false } } } })).toEqual([
      { pointer: '/linkout/providers/neither', message: 'set exactly one of "builtin" or "template"' },
    ]);
  });

  it('requires a price for every configured model', () => {
    expect(issuesFor({ research: { models: { repair: { family: 'anthropic', model: 'unpriced' } } } })).toEqual([
      {
        pointer: '/research/models/repair/model',
        message: 'model "unpriced" has no entry in pricing, so its cost cannot be metered',
      },
    ]);
  });

  it('keeps quoted words within the excerpt limit', () => {
    expect(issuesFor({ licenceGuard: { maxQuotedWords: 30 } })).toEqual([
      { pointer: '/licenceGuard/maxQuotedWords', message: 'must not exceed licenceGuard.maxExcerptWords' },
    ]);
  });

  it('names the source and every issue in the message', () => {
    const error = new ConfigError('a.json', [
      { pointer: '', message: 'one' },
      { pointer: '/x', message: 'two' },
    ]);
    expect(error.name).toBe('ConfigError');
    expect(error.source).toBe('a.json');
    expect(error.message).toBe('Invalid Lectio config (a.json):\n  /: one\n  /x: two');
  });
});

describe('pointerSegment', () => {
  it('escapes ~ and / per RFC 6901', () => {
    expect(pointerSegment('a~b/c')).toBe('a~0b~1c');
  });
});
