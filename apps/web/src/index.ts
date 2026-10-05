/**
 * @lectio/web: the Astro static site. The package entry re-exports the site's build-time helpers (theme and site
 * settings) for tools that need them outside Astro; pages import from `src/lib` directly.
 */
export const packageName = '@lectio/web';

export * from './lib/site.ts';
export * from './lib/theme.ts';
