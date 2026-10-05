/**
 * OG image integration: keeps the share-card images (`@lectio/sharecards`) in a build cache keyed by their input so
 * unchanged cards are not re-rendered. A no-op stub registered by L-050; L-078 implements it here. Do not edit
 * `astro.config.mjs` to add it.
 */
import type { AstroIntegration } from 'astro';

import type { LectioIntegrationOptions } from './types.ts';

export function ogImages(_options: LectioIntegrationOptions): AstroIntegration {
  return {
    name: 'lectio:og',
    hooks: {
      'astro:build:start': () => {
        // L-078: restore the OG image cache.
      },
      'astro:build:done': () => {
        // L-078: save the OG image cache.
      },
    },
  };
}
