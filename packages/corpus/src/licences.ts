/**
 * The attribution list for every corpus edition. `npm run corpus:licences` prints it, and the About page (L-059)
 * renders the same entries at build time, so no generated corpus/README.md is committed.
 */
import { openCorpus } from './corpus.ts';
import type { OpenCorpusOptions } from './corpus.ts';
import type { SourceInfo } from './format.ts';

export interface LicenceEntry extends SourceInfo {
  readonly edition: string;
}

/** Every edition's SOURCE.json, sorted by edition id (code-point order). An absent corpus root gives []. */
export async function listLicences(root: string, options: OpenCorpusOptions = {}): Promise<LicenceEntry[]> {
  const corpus = openCorpus(root, options);
  const editions = await corpus.editions();
  return Promise.all(editions.map(async (edition) => ({ edition, ...(await corpus.source(edition)) })));
}

/** Plain-text attribution list: one block per edition, separated by blank lines, ending in a newline. */
export function formatLicences(entries: readonly LicenceEntry[]): string {
  if (entries.length === 0) return 'No corpus editions found.\n';
  const blocks = entries.map((entry) =>
    [
      `${entry.edition}: ${entry.name}`,
      `  Licence: ${entry.licence}`,
      `  Source: ${entry.upstreamUrl} (${entry.version})`,
      `  ${entry.attribution.trim().replace(/\s*\n\s*/gu, '\n  ')}`,
    ].join('\n'),
  );
  return `${blocks.join('\n\n')}\n`;
}
