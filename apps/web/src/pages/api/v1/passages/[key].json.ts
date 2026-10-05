/** `/api/v1/passages/{key}.json`: the approved notes for one passage (docs/api.md). Built in `src/lib/api.ts`. */
import type { APIContext } from 'astro';

import { apiContext, jsonResponse, passageStaticPaths } from '../../../../lib/api.ts';

export function getStaticPaths() {
  return passageStaticPaths(apiContext().repo);
}

export function GET({ props }: APIContext<{ document: unknown }>): Response {
  return jsonResponse(props.document);
}
