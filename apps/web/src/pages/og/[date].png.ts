/** `/og/[date].png`: the share card of a day page (`src/lib/og.ts`). */
import type { APIRoute } from 'astro';

import { ogDayPaths } from '../../lib/og.ts';
import { siteContext } from '../../lib/site.ts';
import { ogImageResponse } from './_endpoint.ts';

export function getStaticPaths() {
  return ogDayPaths(siteContext().repo);
}

export const GET: APIRoute = ({ params, site }) => ogImageResponse({ kind: 'day', date: String(params.date) }, site);
