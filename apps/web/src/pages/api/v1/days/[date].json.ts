/** `/api/v1/days/{date}.json`: one liturgical day with its approved notes inline (docs/api.md). Built in `src/lib/api.ts`. */
import type { APIContext } from 'astro';

import { apiContext, dayStaticPaths, jsonResponse } from '../../../../lib/api.ts';

export function getStaticPaths() {
  return dayStaticPaths(apiContext().repo);
}

export function GET({ props }: APIContext<{ document: unknown }>): Response {
  return jsonResponse(props.document);
}
