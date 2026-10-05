/** `/api/v1/index.json`: the API entry point (docs/api.md). The document is built in `src/lib/api.ts`. */
import { apiContext, apiIndex, jsonResponse } from '../../../lib/api.ts';

export function GET(): Response {
  return jsonResponse(apiIndex(apiContext()));
}
