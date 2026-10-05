// Astro config for the Lectio site (static output). Written once by L-050: every integration is registered here
// up front and implemented in its own module under src/integrations/, so later issues never edit this file.
// `site` and `base` come from config.site; pages read content through @lectio/content from config.content.root
// (LECTIO_CONFIG selects another config file, e.g. test/lectio.config.fixture.json for `npm run build:fixture`).
import { defineConfig } from 'astro/config';

import { i18nRouting } from './src/integrations/i18n.ts';
import { ogImages } from './src/integrations/og.ts';
import { pagefind } from './src/integrations/pagefind.ts';
import { sitemap } from './src/integrations/sitemap.ts';
import { serviceWorker } from './src/integrations/sw.ts';
import { astroSiteOptions, siteContext } from './src/lib/site.ts';

const { config, contentRoot } = siteContext();
const options = { config, contentRoot };
const bundled = ['ajv', 'ajv-formats'];

export default defineConfig({
  ...astroSiteOptions(config),
  output: 'static',
  trailingSlash: 'always',
  build: { format: 'directory' },
  // No telemetry, no remote fetches: the build works offline.
  devToolbar: { enabled: false },
  vite: {
    // The workspace packages are TypeScript source that use named imports from CommonJS packages (ajv);
    // bundling those into the prerender build gives them Vite's CommonJS interop.
    ssr: { noExternal: bundled },
    environments: { prerender: { resolve: { noExternal: bundled } } },
  },
  integrations: [
    i18nRouting(options),
    sitemap(options),
    ogImages(options),
    serviceWorker(options),
    // Pagefind runs after every page is written, so it stays last (it indexes note documents generated from the
    // content, not dist HTML, and writes dist/pagefind/ after the service worker's build hook).
    pagefind(options),
  ],
});
