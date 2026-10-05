/** `/api/v1/sw/passages/index.json`: `passages/index.json` with Kiswahili summaries where reviewed (L-113). */
import { apiPassageIndex, jsonResponse } from '../../../../../lib/api.ts';
import { swApiContext } from '../_context.ts';

export function GET(): Response {
  return jsonResponse(apiPassageIndex(swApiContext().repo));
}
