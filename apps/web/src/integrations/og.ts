/**
 * OG image integration (L-088). The images themselves are static endpoints (`src/pages/og/`) that render share cards
 * with `@lectio/sharecards`; this integration runs around them:
 *
 * - `astro:config:setup` points the endpoints at the content-hash cache (`<root>/.cache/og`, or `$LECTIO_OG_CACHE_DIR`
 *   when set; CI can keep that directory with actions/cache) and at the sharecards font directory, and keeps
 *   `@resvg/resvg-js` (a native addon) out of the Vite SSR bundle;
 * - `astro:build:start` zeroes the counters;
 * - `astro:build:done` checks every built page's `og:image` (`checkOgDist`; any problem fails the build), prunes
 *   cache entries unused for 30 days and logs how many images were rendered or reused and how long they took.
 *
 * Registered by L-050 in `astro.config.mjs`; do not edit that file. The logic is in src/lib/og.ts.
 */
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { AstroIntegration } from 'astro';

import { OG_CACHE_ENV, OG_FONTS_ENV, checkOgDist, ogStats, pruneOgCache, resetOgStats } from '../lib/og.ts';
import type { OgDistReport } from '../lib/og.ts';
import type { LectioIntegrationOptions } from './types.ts';

/** Native and binary-heavy packages the prerender must load from node_modules rather than bundle. */
export const OG_EXTERNAL = ['@resvg/resvg-js'];

/** The sharecards `fonts/` directory, resolved from its package.json. */
export function sharecardsFontsDir(): string {
  const require = createRequire(import.meta.url);
  return join(dirname(require.resolve('@lectio/sharecards/package.json')), 'fonts');
}

/** The build log line. */
export function ogSummary(report: OgDistReport, stats: { rendered: number; cached: number; ms: number }): string {
  const seconds = (stats.ms / 1000).toFixed(1);
  return (
    `OG images: ${String(stats.rendered)} rendered, ${String(stats.cached)} from cache in ${seconds}s; ` +
    `${String(report.images)} page images checked on ${String(report.pages)} pages`
  );
}

export function ogImages(options: LectioIntegrationOptions): AstroIntegration {
  let cacheDir = '';
  return {
    name: 'lectio:og',
    hooks: {
      'astro:config:setup': ({ config, updateConfig }) => {
        cacheDir = process.env[OG_CACHE_ENV] ?? resolve(fileURLToPath(config.root), '.cache', 'og');
        process.env[OG_CACHE_ENV] = cacheDir;
        process.env[OG_FONTS_ENV] = sharecardsFontsDir();
        updateConfig({
          vite: {
            ssr: { external: OG_EXTERNAL },
            environments: { prerender: { resolve: { external: OG_EXTERNAL } } },
          },
        });
      },
      'astro:build:start': () => {
        resetOgStats();
      },
      'astro:build:done': async ({ dir, logger }) => {
        const report = await checkOgDist(fileURLToPath(dir), options.config.site.baseUrl, options.config.site.basePath);
        if (report.problems.length > 0) {
          throw new Error(`OG image check failed:\n${report.problems.join('\n')}`);
        }
        const pruned = await pruneOgCache(cacheDir);
        logger.info(
          ogSummary(report, ogStats()) + (pruned > 0 ? `; pruned ${String(pruned)} stale cache entries` : ''),
        );
      },
    },
  };
}
