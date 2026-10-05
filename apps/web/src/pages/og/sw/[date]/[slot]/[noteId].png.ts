/** `/og/sw/[date]/[slot]/[noteId].png`: the Kiswahili share card of a `/sw/` Insight page (L-113). */
import type { APIRoute } from 'astro';

import { ogInsightPaths } from '../../../../../lib/og.ts';
import { siteContext } from '../../../../../lib/site.ts';
import { SW, localeCardPaths, ogImageResponse } from '../../../_endpoint.ts';

export function getStaticPaths() {
  return localeCardPaths(SW, ogInsightPaths(siteContext().repo));
}

export const GET: APIRoute = ({ params, site }) =>
  ogImageResponse(
    { kind: 'insight', date: String(params.date), slot: String(params.slot), noteId: String(params.noteId) },
    site,
    SW,
  );
