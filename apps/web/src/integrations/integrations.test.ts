import { readFileSync } from 'node:fs';

import { DEFAULT_CONFIG } from '@lectio/config';
import type { AstroIntegration } from 'astro';
import { describe, expect, it } from 'vitest';

import { i18nRouting } from './i18n.ts';
import { ogImages } from './og.ts';
import { pagefind } from './pagefind.ts';
import { sitemap } from './sitemap.ts';
import { serviceWorker } from './sw.ts';

const options = { config: DEFAULT_CONFIG, contentRoot: '/content' };

const factories: [string, (o: typeof options) => AstroIntegration][] = [
  ['sitemap', sitemap],
  ['pagefind', pagefind],
  ['sw', serviceWorker],
  ['og', ogImages],
  ['i18n', i18nRouting],
];

// Only the stable contract: each module's owner (L-058, L-060, L-061, L-088, L-110) fills in its own
// integration without editing this file.
describe('integration modules', () => {
  it.each(factories)('%s returns a named Astro integration with a hooks object', (_name, create) => {
    const integration = create(options);
    expect(typeof integration.name).toBe('string');
    expect(integration.name.length).toBeGreaterThan(0);
    expect(typeof integration.hooks).toBe('object');
    expect(integration.hooks).not.toBeNull();
  });
});

describe('astro.config.mjs', () => {
  const source = readFileSync(new URL('../../astro.config.mjs', import.meta.url), 'utf8');

  it.each(['sitemap', 'pagefind', 'sw', 'og', 'i18n'])('imports ./src/integrations/%s.ts', (module) => {
    expect(source).toContain(`from './src/integrations/${module}.ts'`);
  });

  it('registers every integration, with Pagefind last', () => {
    const list = /integrations: \[([\s\S]*?)\]/.exec(source)?.[1] ?? '';
    const calls = [...list.matchAll(/(\w+)\(options\)/g)].map((match) => match[1]);
    expect(calls).toEqual(['i18nRouting', 'sitemap', 'ogImages', 'serviceWorker', 'pagefind']);
  });
});
