/** `/og/sw/[date]/[slot].png`: the Kiswahili share card of a `/sw/` Reading page with approved notes (L-113). */
import type { APIRoute } from 'astro';

import { ogReadingPaths } from '../../../../lib/og.ts';
import { siteContext } from '../../../../lib/site.ts';
import { SW, localeCardPaths, ogImageResponse } from '../../_endpoint.ts';

export function getStaticPaths() {
  return localeCardPaths(SW, ogReadingPaths(siteContext().repo));
}

export const GET: APIRoute = ({ params, site }) =>
  ogImageResponse({ kind: 'reading', date: String(params.date), slot: String(params.slot) }, site, SW);
