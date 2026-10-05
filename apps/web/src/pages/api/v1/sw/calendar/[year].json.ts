/** `/api/v1/sw/calendar/{year}.json`: `calendar/{year}.json` with Kiswahili summaries where reviewed (L-113). */
import type { APIContext } from 'astro';

import { calendarStaticPaths, jsonResponse } from '../../../../../lib/api.ts';
import { swApiContext } from '../_context.ts';

export function getStaticPaths() {
  return calendarStaticPaths(swApiContext().repo);
}

export function GET({ props }: APIContext<{ document: unknown }>): Response {
  return jsonResponse(props.document);
}
