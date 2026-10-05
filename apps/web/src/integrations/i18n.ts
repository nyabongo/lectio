/**
 * i18n routing integration, generated from `config.site.locales` and `config.site.defaultLocale`. A no-op stub
 * registered by L-050; L-110 (Kiswahili web UI and /sw/ routes) implements it here, for example by calling
 * `updateConfig({ i18n: { locales, defaultLocale, routing: { prefixDefaultLocale: false } } })` in
 * `astro:config:setup`. Do not edit `astro.config.mjs` to add it.
 */
import type { AstroIntegration } from 'astro';

import type { LectioIntegrationOptions } from './types.ts';

export function i18nRouting(_options: LectioIntegrationOptions): AstroIntegration {
  return {
    name: 'lectio:i18n',
    hooks: {
      'astro:config:setup': () => {
        // L-110: route every locale in config.site.locales (the default locale stays unprefixed).
      },
    },
  };
}
