import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  SERVICE_WORKER_ENTRY,
  buildServiceWorker,
  listFiles,
  serviceWorkerBuildOptions,
  serviceWorkerConfig,
  serviceWorkerSite,
} from './build.ts';

let dir: string;

function write(path: string, content = path): void {
  const file = join(dir, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lectio-sw-'));
  write('index.html', 'home');
  write('offline/index.html', 'offline');
  write('2026-09-20/index.html', 'day');
  write('_astro/app.abc.css', 'css');
  write('fonts/a.woff2', 'font');
  write('manifest.webmanifest', '{}');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('listFiles', () => {
  it('lists every file with /-separated relative paths, sorted', () => {
    expect(listFiles(dir)).toEqual([
      '2026-09-20/index.html',
      '_astro/app.abc.css',
      'fonts/a.woff2',
      'index.html',
      'manifest.webmanifest',
      'offline/index.html',
    ]);
  });
});

describe('serviceWorkerConfig', () => {
  it('precaches the shell and versions it by content', () => {
    const config = serviceWorkerConfig(dir);
    expect(config.precache).toEqual(['', '_astro/app.abc.css', 'fonts/a.woff2', 'manifest.webmanifest', 'offline/']);
    expect(config.version).toMatch(/^[0-9a-f]{12}$/);
    expect(serviceWorkerConfig(dir).version).toBe(config.version);

    // A day page is not part of the shell: changing it keeps the version.
    write('2026-09-20/index.html', 'day, rebuilt');
    expect(serviceWorkerConfig(dir).version).toBe(config.version);
    write('_astro/app.abc.css', 'css, changed');
    expect(serviceWorkerConfig(dir).version).not.toBe(config.version);
    expect(config).toMatchObject({ locales: [], listen: false });
  });

  it("precaches each locale's shell pages and records the locales and Listen in the configuration", () => {
    write('sw/index.html', 'nyumbani');
    write('sw/settings/index.html', 'mipangilio');
    const plain = serviceWorkerConfig(dir);
    const config = serviceWorkerConfig(dir, { locales: ['sw'], listen: true });
    expect(config.precache).toEqual([
      '',
      '_astro/app.abc.css',
      'fonts/a.woff2',
      'manifest.webmanifest',
      'offline/',
      'sw/',
      'sw/settings/',
    ]);
    expect(config).toMatchObject({ locales: ['sw'], listen: true });
    // Turning Listen on changes what the worker prefetches, so it is a new version.
    expect(serviceWorkerConfig(dir, { locales: [], listen: true }).version).not.toBe(plain.version);
  });
});

describe('serviceWorkerSite', () => {
  it('takes the non-default locales and the Listen flag from the site config', () => {
    const site = {
      locales: ['en', 'sw'],
      defaultLocale: 'en',
      features: { listen: true },
    } as unknown as Parameters<typeof serviceWorkerSite>[0];
    expect(serviceWorkerSite(site)).toEqual({ locales: ['sw'], listen: true });
  });
});

describe('serviceWorkerBuildOptions', () => {
  it('bundles one minified browser ES module and injects the configuration', () => {
    const config = { version: 'v1', precache: [''], locales: ['sw'], listen: true };
    expect(serviceWorkerBuildOptions('in.ts', 'out.js', config)).toMatchObject({
      entryPoints: ['in.ts'],
      outfile: 'out.js',
      bundle: true,
      format: 'esm',
      platform: 'browser',
      minify: true,
      define: { __LECTIO_SW__: JSON.stringify(config) },
    });
    expect(serviceWorkerBuildOptions('in.ts', 'out.js').define).toEqual({});
  });
});

describe('buildServiceWorker', () => {
  it('hands esbuild the entry, the output file and the configuration', async () => {
    const build = vi.fn(() => Promise.resolve());
    const site = { locales: ['sw'], listen: true };
    const config = await buildServiceWorker(dir, site, build);
    expect(build).toHaveBeenCalledWith(
      serviceWorkerBuildOptions(SERVICE_WORKER_ENTRY, join(dir, 'sw.js'), serviceWorkerConfig(dir, site)),
    );
    expect(config.listen).toBe(true);
    expect(config.precache).toContain('offline/');
  });

  it('bundles a self-contained worker with the real esbuild', async () => {
    const config = await buildServiceWorker(dir);
    const bundle = readFileSync(join(dir, 'sw.js'), 'utf8');
    expect(bundle).toContain(config.version);
    expect(bundle).toContain('lectio-data-');
    expect(bundle).not.toMatch(/\bimport\s*[{*"']/);
    expect(bundle).not.toContain('__LECTIO_SW__');
  }, 30_000);
});
