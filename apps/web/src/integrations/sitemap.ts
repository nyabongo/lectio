/**
 * Sitemap integration. A no-op stub registered by L-050; L-058 (SEO base) implements it here, for example by
 * returning `@astrojs/sitemap` configured from `options.config.site`. Do not edit `astro.config.mjs` to add it.
 */
import type { AstroIntegration } from 'astro';

import type { LectioIntegrationOptions } from './types.ts';

export function sitemap(_options: LectioIntegrationOptions): AstroIntegration {
  return {
    name: 'lectio:sitemap',
    hooks: {
      'astro:build:done': () => {
        // L-058: write sitemap-index.xml for every page in the build.
      },
    },
  };
}
