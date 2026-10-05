/**
 * What `astro.config.mjs` hands every Lectio integration. The five integration modules (`sitemap.ts`,
 * `pagefind.ts`, `sw.ts`, `og.ts`, `i18n.ts`) are registered once, up front, so later issues fill in their own
 * module and never edit `astro.config.mjs`.
 */
import type { LectioConfig } from '@lectio/config';

export interface LectioIntegrationOptions {
  /** The loaded Lectio config (the file `LECTIO_CONFIG` selects, or `config/lectio.config.json`). */
  readonly config: LectioConfig;
  /** Absolute path of the content repository the build reads. */
  readonly contentRoot: string;
}
