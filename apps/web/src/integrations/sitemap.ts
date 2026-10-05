/**
 * Sitemap integration (L-058): adds `@astrojs/sitemap`, configured from `options.config.site` by
 * `sitemapOptions()` (src/lib/sitemap.ts), and after the build points robots.txt's `Sitemap:` line at the
 * configured site's `sitemap-index.xml`. Registered by L-050 in `astro.config.mjs`; do not edit that file.
 */
import astroSitemap from '@astrojs/sitemap';
import type { AstroIntegration } from 'astro';

import { sitemapIndexUrl, sitemapOptions, updateRobotsFile } from '../lib/sitemap.ts';
import type { LectioIntegrationOptions } from './types.ts';

export function sitemap(options: LectioIntegrationOptions): AstroIntegration {
  return {
    name: 'lectio:sitemap',
    hooks: {
      'astro:config:setup': ({ updateConfig }) => {
        updateConfig({ integrations: [astroSitemap(sitemapOptions(options.config))] });
      },
      'astro:build:done': async ({ dir }) => {
        await updateRobotsFile(dir, sitemapIndexUrl(options.config));
      },
    },
  };
}
