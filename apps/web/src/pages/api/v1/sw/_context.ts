/**
 * The Kiswahili API mirror, `/api/v1/sw/…` (L-113, docs/api.md): the same documents as `/api/v1/…`, built from the
 * content repository as Kiswahili pages read it (`siteRepo('sw')` in src/lib/notes-locale.ts). Each passage is its
 * approved, up-to-date Kiswahili translation (`locale: "sw"`) or the English notes (`locale: "en"`).
 */
import { apiContext } from '../../../../lib/api.ts';
import type { ApiContext } from '../../../../lib/api.ts';
import { siteRepo } from '../../../../lib/notes-locale.ts';

/** The locale this directory mirrors the API in. */
export const API_LOCALE = 'sw';

/** The build's API context with the Kiswahili view of the content repository. */
export function swApiContext(): ApiContext {
  return { ...apiContext(), repo: siteRepo(API_LOCALE) };
}
