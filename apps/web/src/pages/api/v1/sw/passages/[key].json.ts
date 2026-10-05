/** `/api/v1/sw/passages/{key}.json`: `passages/{key}.json` with Kiswahili notes where reviewed (L-113). */
import type { APIContext } from 'astro';

import { jsonResponse, passageStaticPaths } from '../../../../../lib/api.ts';
import { swApiContext } from '../_context.ts';

export function getStaticPaths() {
  return passageStaticPaths(swApiContext().repo);
}

export function GET({ props }: APIContext<{ document: unknown }>): Response {
  return jsonResponse(props.document);
}
