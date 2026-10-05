/** `/api/v1/sw/upcoming.json`: `upcoming.json` with Kiswahili summaries where reviewed (docs/api.md, L-113). */
import { apiUpcoming, jsonResponse } from '../../../../lib/api.ts';
import { swApiContext } from './_context.ts';

export function GET(): Response {
  return jsonResponse(apiUpcoming(swApiContext()));
}
