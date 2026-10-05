/** `/og/[date]/[slot].png`: the share card of a Reading page with approved notes (`src/lib/og.ts`). */
import type { APIRoute } from 'astro';

import { ogReadingPaths } from '../../../lib/og.ts';
import { siteContext } from '../../../lib/site.ts';
import { ogImageResponse } from '../_endpoint.ts';

export function getStaticPaths() {
  return ogReadingPaths(siteContext().repo);
}

export const GET: APIRoute = ({ params, site }) =>
  ogImageResponse({ kind: 'reading', date: String(params.date), slot: String(params.slot) }, site);
