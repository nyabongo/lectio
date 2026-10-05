import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { DEFAULT_CONFIG } from '@lectio/config';
import type { AstroIntegration } from 'astro';
import { describe, expect, it, vi } from 'vitest';

import { sitemap } from './sitemap.ts';

type Hook<K extends keyof AstroIntegration['hooks']> = NonNullable<AstroIntegration['hooks'][K]>;

const options = {
  config: { ...DEFAULT_CONFIG, site: { ...DEFAULT_CONFIG.site, baseUrl: 'https://lectio.example/', basePath: '/x' } },
  contentRoot: '/content',
};

describe('sitemap integration', () => {
  it('adds @astrojs/sitemap during config setup', () => {
    const updateConfig = vi.fn();
    const setup = sitemap(options).hooks['astro:config:setup'] as Hook<'astro:config:setup'>;
    void setup({ updateConfig } as unknown as Parameters<typeof setup>[0]);
    expect(updateConfig).toHaveBeenCalledOnce();
    const [{ integrations }] = updateConfig.mock.calls[0] as [{ integrations: AstroIntegration[] }];
    expect(integrations.map((integration) => integration.name)).toEqual(['@astrojs/sitemap']);
  });

  it('points the built robots.txt at the configured sitemap index', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lectio-sitemap-'));
    try {
      await writeFile(join(dir, 'robots.txt'), 'User-agent: *\nSitemap: https://old.example/sitemap-index.xml\n');
      const done = sitemap(options).hooks['astro:build:done'] as Hook<'astro:build:done'>;
      await done({ dir: pathToFileURL(`${dir}/`) } as unknown as Parameters<typeof done>[0]);
      expect(await readFile(join(dir, 'robots.txt'), 'utf8')).toBe(
        'User-agent: *\nSitemap: https://lectio.example/x/sitemap-index.xml\n',
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
