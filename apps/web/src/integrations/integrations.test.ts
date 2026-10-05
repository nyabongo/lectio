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

const integrations: [string, (o: typeof options) => AstroIntegration, string[]][] = [
  ['sitemap', sitemap, ['astro:build:done']],
  ['pagefind', pagefind, ['astro:build:done']],
  ['sw', serviceWorker, ['astro:build:done']],
  ['og', ogImages, ['astro:build:start', 'astro:build:done']],
  ['i18n', i18nRouting, ['astro:config:setup']],
];

describe('integration stubs', () => {
  it.each(integrations)('%s is a named no-op integration with its hooks registered', async (name, create, hooks) => {
    const integration = create(options);
    expect(integration.name).toBe(`lectio:${name}`);
    expect(Object.keys(integration.hooks).sort()).toEqual([...hooks].sort());
    for (const hook of hooks) {
      const run = integration.hooks[hook as keyof AstroIntegration['hooks']] as (() => unknown) | undefined;
      expect(typeof run).toBe('function');
      await expect(Promise.resolve(run?.())).resolves.toBeUndefined();
    }
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
