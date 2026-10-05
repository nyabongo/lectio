/**
 * Service-worker build integration (L-061). After the pages are written, bundles `src/sw/index.ts` into
 * `dist/sw.js` with the precache manifest (the app shell) injected. The logic lives in `src/sw/build.ts` (inside the
 * coverage include); the caching policy in `src/lib/sw-policy.ts`.
 *
 * Tooling decision (L-050): the worker is hand-written TypeScript bundled with esbuild (a direct dependency of
 * apps/web); there is no Workbox. Pagefind runs after this hook, so the search bundle is cached at run time.
 * Registered in `astro.config.mjs` by L-050; do not edit that file to add it.
 */
import { fileURLToPath } from 'node:url';

import type { AstroIntegration } from 'astro';

import { buildServiceWorker } from '../sw/build.ts';
import type { LectioIntegrationOptions } from './types.ts';

export function serviceWorker(_options: LectioIntegrationOptions): AstroIntegration {
  return {
    name: 'lectio:sw',
    hooks: {
      'astro:build:done': async ({ dir, logger }) => {
        const { precache } = await buildServiceWorker(fileURLToPath(dir));
        logger.info(`Service worker built with ${String(precache.length)} precached files`);
      },
    },
  };
}
