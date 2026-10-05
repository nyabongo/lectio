/**
 * Service-worker build integration. A stub registered by L-050; L-061 (PWA) implements it here.
 *
 * Tooling decision (L-050): the service worker is hand-written TypeScript under `apps/web/src/sw` (already in the
 * coverage include), with its caching policy in `src/lib/sw-policy.ts`. It is bundled with esbuild, a direct
 * dependency of apps/web pinned to the lockfile's version, so L-061 never touches package.json or the lockfile.
 * There is no Workbox. After the pages are written, this integration bundles `src/sw/index.ts` into `dist/sw.js`
 * and injects the precache manifest (the shell and the next seven days). Do not edit `astro.config.mjs` to add it.
 */
import type { BuildOptions } from 'esbuild';
import type { AstroIntegration } from 'astro';

import type { LectioIntegrationOptions } from './types.ts';

/** The esbuild options for the worker bundle: one self-contained ES module for modern browsers. */
export function serviceWorkerBuildOptions(entry: string, outfile: string): BuildOptions {
  return {
    entryPoints: [entry],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    minify: true,
    sourcemap: false,
    logLevel: 'warning',
  };
}

/**
 * The build step. A no-op until L-061 fills it, for example:
 * `await build({ ...serviceWorkerBuildOptions(entry, outfile), define: { __PRECACHE__: JSON.stringify(urls) } })`
 * with `build` from `esbuild`, `entry` = `src/sw/index.ts` and `outfile` = `<dist>/sw.js`.
 */
export async function buildServiceWorker(_options: LectioIntegrationOptions, _outDir: URL): Promise<void> {
  // L-061: bundle src/sw with esbuild and inject the precache manifest.
}

export function serviceWorker(options: LectioIntegrationOptions): AstroIntegration {
  return {
    name: 'lectio:sw',
    hooks: {
      'astro:build:done': async ({ dir }) => {
        await buildServiceWorker(options, dir);
      },
    },
  };
}
