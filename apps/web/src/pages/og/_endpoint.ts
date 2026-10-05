/**
 * Shared by the OG image endpoints in this directory and its `sw/` mirror (L-113) (the leading underscore keeps it out of the routes): the
 * card context the pages use (messages, base-aware paths, the site URL and the content) and the render-and-respond
 * step, which goes through the build cache the integration set up (src/integrations/og.ts).
 */
import { DEFAULT_LOCALE, formatDate, localePath, t } from '../../i18n/index.ts';
import { ogCard, ogEnvOptions, pngResponse, renderOgImage } from '../../lib/og.ts';
import type { OgContext, OgTarget } from '../../lib/og.ts';
import { siteRepo } from '../../lib/notes-locale.ts';
import { siteContext, withBase } from '../../lib/site.ts';

/**
 * The card context in `lang` (the default locale unless given): the content as pages in that language read it
 * (`siteRepo`, L-113), so a Kiswahili card shows the Kiswahili notes where they are reviewed.
 */
export function ogContext(site: URL | undefined, lang: string = DEFAULT_LOCALE): OgContext {
  const { config } = siteContext();
  const base = import.meta.env.BASE_URL;
  return {
    env: { lang, messages: { t, formatDate }, paths: (path) => withBase(base, localePath(lang, path)) },
    site: site ?? config.site.baseUrl,
    base,
    config,
    repo: siteRepo(lang),
    defaultLocale: DEFAULT_LOCALE,
  };
}

/**
 * The PNG response for one image in `lang` (the default locale unless given); throws when the content has no card
 * for it (the static paths prevent that).
 */
export async function ogImageResponse(target: OgTarget, site: URL | undefined, lang?: string): Promise<Response> {
  const card = ogCard(ogContext(site, lang), target);
  if (card === null) throw new Error(`no share card for ${JSON.stringify(target)}`);
  return pngResponse(await renderOgImage(card, ogEnvOptions()));
}
