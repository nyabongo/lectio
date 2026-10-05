/**
 * Records the source pages the committed passages cite into tests/gates/fixtures/seed-pages/
 * (see ./seed-pages.ts for what is kept). Goes online, so it is never run by the tests:
 *
 *     npx tsx tests/gates/helpers/record-seed-pages.ts
 *
 * Pages come through the live fetcher (`@lectio/provider-fetch`: LectioBot, robots.txt honoured).
 * Set `LECTIO_SOURCE_CACHE_DIR`-style caching with `RECORD_CACHE_DIR=<dir>` to reuse a previous fetch.
 * The log lists each page's kept sections and every excerpt that is missing from its page.
 */
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { LiveSourceFetcher } from '@lectio/provider-fetch';
import type { FakeSourcePage } from '@lectio/providers';

import { REPO_ROOT, contentFiles } from './gate-test.ts';
import { fixtureName, reducePage } from './seed-pages.ts';

export const SEED_PAGES_DIR = join(REPO_ROOT, 'tests', 'gates', 'fixtures', 'seed-pages');

interface WebSource {
  readonly type: string;
  readonly url?: string;
  readonly excerpt?: string;
}

/** Every cited web URL with its excerpts, in URL order. */
function citedPages(): Map<string, string[]> {
  const pages = new Map<string, string[]>();
  for (const file of contentFiles().filter((path) => path.includes('passages/'))) {
    const passage = JSON.parse(readFileSync(join(REPO_ROOT, file), 'utf8')) as { sources?: WebSource[] };
    for (const source of passage.sources ?? []) {
      if (source.type !== 'web' || source.url === undefined) continue;
      const excerpts = pages.get(source.url) ?? [];
      if (source.excerpt !== undefined && !excerpts.includes(source.excerpt)) excerpts.push(source.excerpt);
      pages.set(source.url, excerpts);
    }
  }
  return new Map([...pages].sort(([a], [b]) => a.localeCompare(b)));
}

async function main(): Promise<void> {
  const cacheDir = process.env['RECORD_CACHE_DIR'];
  const fetcher = new LiveSourceFetcher({ cacheDir: cacheDir ?? false });
  rmSync(SEED_PAGES_DIR, { recursive: true, force: true });
  mkdirSync(SEED_PAGES_DIR, { recursive: true });
  const index: Record<string, FakeSourcePage> = {};
  let problems = 0;
  for (const [url, excerpts] of citedPages()) {
    const page = await fetcher.fetch(url);
    if (page.status >= 400) {
      console.log(`HTTP ${String(page.status)} ${url}`);
      index[url] = { status: page.status, contentType: page.contentType, text: '' };
      problems++;
      continue;
    }
    const reduced = reducePage(url, page.text, excerpts);
    const file = fixtureName(url);
    writeFileSync(join(SEED_PAGES_DIR, file), reduced.text, 'utf8');
    index[url] = {
      file,
      contentType: page.contentType,
      ...(page.finalUrl !== undefined && page.finalUrl !== url ? { finalUrl: page.finalUrl } : {}),
    };
    console.log(`${url}: ${reduced.sections.join(', ') || '(lines only)'}`);
    for (const excerpt of reduced.missing) console.log(`  MISSING ${JSON.stringify(excerpt)}`);
    for (const excerpt of reduced.unplaced) console.log(`  UNPLACED ${JSON.stringify(excerpt)}`);
    problems += reduced.missing.length + reduced.unplaced.length;
  }
  writeFileSync(join(SEED_PAGES_DIR, 'index.json'), `${JSON.stringify(index, null, 2)}\n`, 'utf8');
  console.log(`${String(Object.keys(index).length)} pages recorded, ${String(problems)} problems`);
  console.log(`files: ${String(readdirSync(SEED_PAGES_DIR).length)}`);
}

await main();
