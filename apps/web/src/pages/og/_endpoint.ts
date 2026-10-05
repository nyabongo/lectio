/**
 * Shared by the three OG image endpoints in this directory (the leading underscore keeps it out of the routes): the
 * card context the pages use (messages, base-aware paths, the site URL and the content) and the render-and-respond
 * step, which goes through the build cache the integration set up (src/integrations/og.ts).
 */
import { DEFAULT_LOCALE, formatDate, localePath, t } from '../../i18n/index.ts';
import { ogCard, ogEnvOptions, pngResponse, renderOgImage } from '../../lib/og.ts';
import type { OgContext, OgTarget } from '../../lib/og.ts';
import { siteContext, withBase } from '../../lib/site.ts';

function context(site: URL | undefined): OgContext {
  const { config, repo } = siteContext();
  const base = import.meta.env.BASE_URL;
  const lang = DEFAULT_LOCALE;
  return {
    env: { lang, messages: { t, formatDate }, paths: (path) => withBase(base, localePath(lang, path)) },
    site: site ?? config.site.baseUrl,
    base,
    config,
    repo,
  };
}

/** The PNG response for one image; throws when the content has no card for it (the static paths prevent that). */
export async function ogImageResponse(target: OgTarget, site: URL | undefined): Promise<Response> {
  const card = ogCard(context(site), target);
  if (card === null) throw new Error(`no share card for ${JSON.stringify(target)}`);
  return pngResponse(await renderOgImage(card, ogEnvOptions()));
}
