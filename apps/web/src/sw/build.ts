/**
 * The service worker build step (L-061), run by `src/integrations/sw.ts` after Astro has written every page: list
 * the built files, pick the precache list (`precachePaths` in sw-policy.ts), derive a version from their contents and
 * bundle `src/sw/index.ts` with esbuild into `<outDir>/sw.js` with that configuration injected.
 *
 * Pagefind writes `pagefind/` after this hook runs, so the search bundle is not precached; the worker caches it at
 * run time instead.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { BuildOptions } from 'esbuild';

import { SERVICE_WORKER_FILE, precachePaths } from '../lib/sw-policy.ts';
import type { ServiceWorkerConfig } from '../lib/sw-policy.ts';

/** The worker's entry module. */
export const SERVICE_WORKER_ENTRY = fileURLToPath(new URL('./index.ts', import.meta.url));

/** Every file under `dir`, as `/`-separated paths relative to it, sorted. */
export function listFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)).split(sep).join('/'))
    .sort();
}

/** The worker configuration for the build in `outDir`: the precache list and a version hashed from its files. */
export function serviceWorkerConfig(outDir: string): ServiceWorkerConfig {
  const precache = precachePaths(listFiles(outDir));
  const hash = createHash('sha256');
  for (const path of precache) {
    hash.update(path);
    hash.update('\0');
    hash.update(readFileSync(join(outDir, path === '' || path.endsWith('/') ? `${path}index.html` : path)));
    hash.update('\0');
  }
  return { version: hash.digest('hex').slice(0, 12), precache };
}

/** The esbuild options for the worker bundle: one self-contained, minified ES module for modern browsers. */
export function serviceWorkerBuildOptions(entry: string, outfile: string, config?: ServiceWorkerConfig): BuildOptions {
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
    define: config === undefined ? {} : { __LECTIO_SW__: JSON.stringify(config) },
  };
}

/** esbuild's `build`, injectable for tests. */
export type EsbuildBuild = (options: BuildOptions) => Promise<unknown>;

/** Bundles the worker into `<outDir>/sw.js`; returns its configuration. */
export async function buildServiceWorker(outDir: string, build?: EsbuildBuild): Promise<ServiceWorkerConfig> {
  const config = serviceWorkerConfig(outDir);
  const run = build ?? (await import('esbuild')).build;
  await run(serviceWorkerBuildOptions(SERVICE_WORKER_ENTRY, join(outDir, SERVICE_WORKER_FILE), config));
  return config;
}
