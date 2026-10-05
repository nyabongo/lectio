/** `/api/v1/passages/index.json`: every passage with approved notes (docs/api.md). Built in `src/lib/api.ts`. */
import { apiContext, apiPassageIndex, jsonResponse } from '../../../../lib/api.ts';

export function GET(): Response {
  return jsonResponse(apiPassageIndex(apiContext().repo));
}
