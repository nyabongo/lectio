/** `/api/v1/upcoming.json`: the build date and the 13 days after it (docs/api.md). Built in `src/lib/api.ts`. */
import { apiContext, apiUpcoming, jsonResponse } from '../../../lib/api.ts';

export function GET(): Response {
  return jsonResponse(apiUpcoming(apiContext()));
}
