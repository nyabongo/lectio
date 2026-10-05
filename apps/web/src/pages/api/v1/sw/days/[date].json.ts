/** `/api/v1/sw/days/{date}.json`: `days/{date}.json` with Kiswahili notes where reviewed (docs/api.md, L-113). */
import type { APIContext } from 'astro';

import { dayStaticPaths, jsonResponse } from '../../../../../lib/api.ts';
import { swApiContext } from '../_context.ts';

export function getStaticPaths() {
  return dayStaticPaths(swApiContext().repo);
}

export function GET({ props }: APIContext<{ document: unknown }>): Response {
  return jsonResponse(props.document);
}
