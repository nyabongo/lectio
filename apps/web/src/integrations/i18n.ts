/**
 * i18n routing integration (L-110), generated from `config.site.locales` and `config.site.defaultLocale`.
 *
 * It turns on Astro's i18n routing with the default locale unprefixed and injects a `/<locale>/…` mirror of every
 * page type for every other locale (`/sw/`, `/sw/calendar/`, `/sw/2026-09-20/gospel/` …). Each mirror is rendered by the same page file; the list comes from `localeRoutes()`
 * in src/lib/locale-routes.ts, so a new page is localised with no edit here. The JSON API and the 404 page are not
 * mirrored. Registered by L-050; do not edit `astro.config.mjs`.
 */
import { fileURLToPath } from 'node:url';

import type { AstroIntegration } from 'astro';

import { listPageFiles, localeRoutes } from '../lib/locale-routes.ts';
import type { LectioIntegrationOptions } from './types.ts';

export function i18nRouting(options: LectioIntegrationOptions): AstroIntegration {
  const { locales, defaultLocale } = options.config.site;
  return {
    name: 'lectio:i18n',
    hooks: {
      'astro:config:setup': async ({ config, updateConfig, injectRoute }) => {
        updateConfig({
          i18n: {
            locales: [...locales],
            defaultLocale,
            routing: { prefixDefaultLocale: false, redirectToDefaultLocale: false, fallbackType: 'redirect' },
          },
        });
        if (locales.length < 2) return;
        const pagesDir = fileURLToPath(new URL('pages/', config.srcDir));
        for (const route of localeRoutes(await listPageFiles(pagesDir), pagesDir, locales, defaultLocale))
          injectRoute({ ...route, prerender: true });
      },
    },
  };
}
