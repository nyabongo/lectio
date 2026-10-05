/**
 * Pagefind integration: indexes the built HTML after the build. A no-op stub registered by L-050; L-060 (Pagefind
 * static search) implements it here with the `pagefind` package already installed. Do not edit
 * `astro.config.mjs` to add it.
 */
import type { AstroIntegration } from 'astro';

import type { LectioIntegrationOptions } from './types.ts';

export function pagefind(_options: LectioIntegrationOptions): AstroIntegration {
  return {
    name: 'lectio:pagefind',
    hooks: {
      'astro:build:done': () => {
        // L-060: run Pagefind over the output directory (it must run after every page is written).
      },
    },
  };
}
