/** `/api/v1/calendar/{year}.json`: every day of one civil year (docs/api.md). Built in `src/lib/api.ts`. */
import type { APIContext } from 'astro';

import { apiContext, calendarStaticPaths, jsonResponse } from '../../../../lib/api.ts';

export function getStaticPaths() {
  return calendarStaticPaths(apiContext().repo);
}

export function GET({ props }: APIContext<{ document: unknown }>): Response {
  return jsonResponse(props.document);
}
