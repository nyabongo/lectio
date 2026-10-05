/** `/og/[date]/[slot]/[noteId].png`: the share card of an Insight page (`src/lib/og.ts`). */
import type { APIRoute } from 'astro';

import { ogInsightPaths } from '../../../../lib/og.ts';
import { siteContext } from '../../../../lib/site.ts';
import { ogImageResponse } from '../../_endpoint.ts';

export function getStaticPaths() {
  return ogInsightPaths(siteContext().repo);
}

export const GET: APIRoute = ({ params, site }) =>
  ogImageResponse(
    { kind: 'insight', date: String(params.date), slot: String(params.slot), noteId: String(params.noteId) },
    site,
  );
