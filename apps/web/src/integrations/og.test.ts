/**
 * The `lectio:og` integration's hooks: cache and font directories for the endpoints, resvg kept out of the SSR
 * bundle, the post-build check that fails the build on a bad `og:image`, and the build log line.
 */
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { DEFAULT_CONFIG } from '@lectio/config';
import { FONT_FILES } from '@lectio/sharecards';
import type { AstroIntegration } from 'astro';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OG_CACHE_ENV, OG_FONTS_ENV, ogStats } from '../lib/og.ts';
import { OG_EXTERNAL, ogImages, ogSummary, sharecardsFontsDir } from './og.ts';

type Hooks = AstroIntegration['hooks'];
type Setup = NonNullable<Hooks['astro:config:setup']>;
type Start = NonNullable<Hooks['astro:build:start']>;
type Done = NonNullable<Hooks['astro:build:done']>;

const options = { config: DEFAULT_CONFIG, contentRoot: '/content' };
const SITE_ROOT = 'https://nyabongo.github.io/lectio/';

let dir: string;
const saved = { cache: process.env[OG_CACHE_ENV], fonts: process.env[OG_FONTS_ENV] };

function restore(name: string, value: string | undefined): void {
  if (value === undefined) Reflect.deleteProperty(process.env, name);
  else process.env[name] = value;
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'lectio-og-integration-'));
  Reflect.deleteProperty(process.env, OG_CACHE_ENV);
});

afterEach(async () => {
  restore(OG_CACHE_ENV, saved.cache);
  restore(OG_FONTS_ENV, saved.fonts);
  await rm(dir, { recursive: true, force: true });
});

function setup(integration: AstroIntegration, root: string): ReturnType<typeof vi.fn> {
  const updateConfig = vi.fn();
  (integration.hooks['astro:config:setup'] as Setup)({
    config: { root: pathToFileURL(`${root}/`) },
    updateConfig,
  } as unknown as Parameters<Setup>[0]);
  return updateConfig;
}

async function done(integration: AstroIntegration, dist: string, info: (message: string) => void): Promise<void> {
  await (integration.hooks['astro:build:done'] as Done)({
    dir: pathToFileURL(`${dist}/`),
    logger: { info },
  } as unknown as Parameters<Done>[0]);
}

function png(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(64);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.write('IHDR', 12, 'latin1');
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

async function page(dist: string, path: string, image: string): Promise<void> {
  await mkdir(join(dist, path), { recursive: true });
  await writeFile(
    join(dist, path, 'index.html'),
    `<meta property="og:image" content="${SITE_ROOT}${image}">` +
      '<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">' +
      '<meta property="og:image:alt" content="A card">',
  );
}

describe('astro:config:setup', () => {
  it('points the endpoints at <root>/.cache/og and the sharecards fonts, and keeps resvg external', () => {
    const updateConfig = setup(ogImages(options), dir);
    expect(process.env[OG_CACHE_ENV]).toBe(join(dir, '.cache', 'og'));
    expect(process.env[OG_FONTS_ENV]).toBe(sharecardsFontsDir());
    expect(updateConfig).toHaveBeenCalledWith({
      vite: { ssr: { external: OG_EXTERNAL }, environments: { prerender: { resolve: { external: OG_EXTERNAL } } } },
    });
    expect(OG_EXTERNAL).toContain('@resvg/resvg-js');
  });

  it('keeps a cache directory set in the environment', () => {
    process.env[OG_CACHE_ENV] = join(dir, 'ci-cache');
    setup(ogImages(options), dir);
    expect(process.env[OG_CACHE_ENV]).toBe(join(dir, 'ci-cache'));
  });

  it('finds the bundled font files', () => {
    for (const { file } of FONT_FILES) expect(existsSync(join(sharecardsFontsDir(), file)), file).toBe(true);
  });
});

describe('astro:build:start and astro:build:done', () => {
  it('zeroes the counters, checks the pages, prunes the cache and logs the summary', async () => {
    const integration = ogImages(options);
    const cache = join(dir, 'cache');
    process.env[OG_CACHE_ENV] = cache;
    setup(integration, dir);
    await mkdir(cache, { recursive: true });
    await writeFile(join(cache, 'stale.png'), 'x');
    await utimes(join(cache, 'stale.png'), new Date(0), new Date(0));

    Object.assign(ogStats(), { rendered: 9, cached: 9, ms: 9 });
    await (integration.hooks['astro:build:start'] as Start)({} as Parameters<Start>[0]);
    expect(ogStats()).toEqual({ rendered: 0, cached: 0, ms: 0 });

    const dist = join(dir, 'dist');
    await mkdir(join(dist, 'og'), { recursive: true });
    await writeFile(join(dist, 'og', '2026-09-20.png'), png(1200, 630));
    await page(dist, '2026-09-20', 'og/2026-09-20.png');
    const logged: string[] = [];
    await done(integration, dist, (message) => logged.push(message));
    expect(logged).toEqual([
      'OG images: 0 rendered, 0 from cache in 0.0s; 1 page images checked on 1 pages; pruned 1 stale cache entries',
    ]);
    expect(existsSync(join(cache, 'stale.png'))).toBe(false);

    logged.length = 0;
    await done(integration, dist, (message) => logged.push(message));
    expect(logged).toEqual(['OG images: 0 rendered, 0 from cache in 0.0s; 1 page images checked on 1 pages']);
  });

  it('fails the build when a page has a bad og:image', async () => {
    const integration = ogImages(options);
    setup(integration, dir);
    const dist = join(dir, 'dist');
    await page(dist, '2026-09-20', 'og/2026-09-20.png');
    await expect(done(integration, dist, () => undefined)).rejects.toThrow(
      /OG image check failed:\n2026-09-20\/index.html: og\/2026-09-20.png does not exist/,
    );
  });
});

describe('ogSummary', () => {
  it('reports what was rendered, reused and checked, with the time in seconds', () => {
    expect(ogSummary({ pages: 34, images: 6, problems: [] }, { rendered: 4, cached: 2, ms: 1234 })).toBe(
      'OG images: 4 rendered, 2 from cache in 1.2s; 6 page images checked on 34 pages',
    );
  });
});
