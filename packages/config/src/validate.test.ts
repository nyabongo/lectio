import { describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG } from './defaults.ts';
import { deepMerge } from './merge.ts';
import { ConfigError, familyOfModel, pointerSegment, validateConfig } from './validate.ts';
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
    const issues = issuesFor({ verifiers: { refuter: { family: 'anthropic', model: 'claude-haiku-4-5-20251001' } } });
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

  it('rejects a family label that contradicts the model id', () => {
    expect(issuesFor({ verifiers: { refuter: { family: 'openai', model: 'claude-sonnet-5-5' } } })).toEqual(
      expect.arrayContaining([
        {
          pointer: '/verifiers/refuter/family',
          message: '"openai" does not match model "claude-sonnet-5-5", which belongs to the anthropic family',
        },
      ]),
    );
    expect(issuesFor({ research: { models: { cheap: { family: 'anthropic', model: 'gpt-5' } } } })).toEqual([
      {
        pointer: '/research/models/cheap/family',
        message: '"anthropic" does not match model "gpt-5", which belongs to the openai family',
      },
    ]);
  });

  it('trusts the family label for model ids without a known prefix', () => {
    const config = validateConfig(
      deepMerge(DEFAULT_CONFIG, {
        verifiers: { refuter: { family: 'google', model: 'custom-model' } },
        pricing: { 'custom-model': { inputPerMTok: 1, outputPerMTok: 1 } },
      }),
    );
    expect(config.verifiers.refuter.family).toBe('google');
  });

  it('validates the Anthropic tool versions', () => {
    expect(issuesFor({ tools: { anthropic: { webSearch: 'web_search_latest', extra: 'x' } } })).toEqual(
      expect.arrayContaining([
        { pointer: '/tools/anthropic/webSearch', message: 'must match pattern "^web_search_[0-9]{8}$"' },
        { pointer: '/tools/anthropic/extra', message: 'unknown key' },
      ]),
    );
    const config = validateConfig(
      deepMerge(DEFAULT_CONFIG, { tools: { anthropic: { webFetch: 'web_fetch_20250910' } } }),
    );
    expect(config.tools.anthropic.webFetch).toBe('web_fetch_20250910');
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

describe('familyOfModel', () => {
  it('maps known prefixes to families', () => {
    expect(familyOfModel('claude-opus-5-5')).toBe('anthropic');
    expect(familyOfModel('gpt-5')).toBe('openai');
    expect(familyOfModel('o3')).toBe('openai');
    expect(familyOfModel('gemini-2.5-pro')).toBe('google');
    expect(familyOfModel('fake')).toBeUndefined();
  });
});
