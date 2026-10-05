/** `/og/sw/[date].png`: the Kiswahili share card of a `/sw/` day page (`src/lib/og.ts`, L-113). */
import type { APIRoute } from 'astro';

import { ogDayPaths } from '../../../lib/og.ts';
import { siteContext } from '../../../lib/site.ts';
import { SW, localeCardPaths, ogImageResponse } from '../_endpoint.ts';

export function getStaticPaths() {
  return localeCardPaths(SW, ogDayPaths(siteContext().repo));
}

export const GET: APIRoute = ({ params, site }) =>
  ogImageResponse({ kind: 'day', date: String(params.date) }, site, SW);
