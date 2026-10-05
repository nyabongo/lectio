/**
 * Service-worker build integration. A no-op stub registered by L-050; L-058 (PWA) implements it here.
 *
 * Tooling decision (L-050): the service worker is hand-written TypeScript under `apps/web/src/sw` (already in the
 * coverage include), with its caching policy in `src/lib/sw-policy.ts`. There is no Workbox dependency; this
 * integration's job is to bundle `src/sw` and write the precache manifest (shell, next seven days) into the build
 * output after the pages exist. Do not edit `astro.config.mjs` to add it.
 */
import type { AstroIntegration } from 'astro';

import type { LectioIntegrationOptions } from './types.ts';

export function serviceWorker(_options: LectioIntegrationOptions): AstroIntegration {
  return {
    name: 'lectio:sw',
    hooks: {
      'astro:build:done': () => {
        // L-058: bundle src/sw and inject the precache manifest into dist/sw.js.
      },
    },
  };
}
