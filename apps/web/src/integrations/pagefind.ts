/**
 * Pagefind integration (L-060): after `astro build` has written every page, indexes the note content of every
 * approved Reading page with the Pagefind node API and writes the bundle (index plus Pagefind's UI) to
 * `<outDir>/pagefind/`, where the `/search/` page loads it. Registered last by L-050 in `astro.config.mjs`; do not
 * edit that file.
 *
 * The documents are built from the content repository by src/lib/search.ts (only approved notes, no reading text);
 * this module only supplies the UI-catalog labels (season, slot, date, book) and the real `pagefind` package.
 * Only the default locale is indexed (a Kiswahili index is L-113).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openRepo } from '@lectio/content';
import { getBook, isBookCode } from '@lectio/refs';
import type { AstroIntegration } from 'astro';

import { seasonName, slotLabel } from '../lib/day.ts';
import type { DayEnv } from '../lib/day.ts';
import { buildCatalogs, formatDate, translate } from '../lib/i18n.ts';
import { PAGEFIND_DIR, searchDocuments, writeSearchIndex } from '../lib/search.ts';
import type { PagefindApi, SearchLabels } from '../lib/search.ts';
import type { LectioIntegrationOptions } from './types.ts';

const I18N_DIR = fileURLToPath(new URL('../i18n/', import.meta.url));

/** The UI catalogs, read from src/i18n/<locale>/<feature>.json (the same files src/i18n/index.ts globs). */
function loadCatalogs(defaultLocale: string): ReturnType<typeof buildCatalogs> {
  const modules: Record<string, unknown> = {};
  for (const locale of readdirSync(I18N_DIR, { withFileTypes: true }).filter((entry) => entry.isDirectory()))
    for (const file of readdirSync(join(I18N_DIR, locale.name)).filter((name) => name.endsWith('.json')))
      modules[`./${locale.name}/${file}`] = JSON.parse(readFileSync(join(I18N_DIR, locale.name, file), 'utf8'));
  return buildCatalogs(modules, defaultLocale);
}

/** The labels the search documents carry, in `lang`. */
export function searchLabels(options: LectioIntegrationOptions, lang: string): SearchLabels {
  const { site } = options.config;
  const catalogs = loadCatalogs(site.defaultLocale);
  const dateText = (date: string): string => formatDate(lang, date, site.timezone);
  const env: DayEnv = {
    lang,
    messages: {
      t: (locale, key, params) => translate(catalogs, locale, key, params),
      formatDate: (_l, d) => dateText(d),
    },
    paths: (path) => path,
  };
  return {
    book: (code) => (isBookCode(code) ? getBook(code).name : code),
    season: (season) => seasonName(env, season),
    slot: (slot) => slotLabel(env, slot),
    date: dateText,
  };
}

/** Builds the search index for the site in `outDir`; returns the number of pages indexed. */
export async function buildSearchIndex(
  options: LectioIntegrationOptions,
  outDir: string,
  api?: PagefindApi,
): Promise<number> {
  const lang = options.config.site.defaultLocale;
  const docs = searchDocuments(openRepo(options.contentRoot), lang, searchLabels(options, lang));
  return writeSearchIndex(api ?? (await import('pagefind')), docs, join(outDir, PAGEFIND_DIR), lang);
}

export function pagefind(options: LectioIntegrationOptions): AstroIntegration {
  return {
    name: 'lectio:pagefind',
    hooks: {
      // Runs after every page is written (this integration is registered last).
      'astro:build:done': async ({ dir, logger }) => {
        const count = await buildSearchIndex(options, fileURLToPath(dir));
        logger.info(`Pagefind indexed ${String(count)} reading page${count === 1 ? '' : 's'}`);
      },
    },
  };
}
