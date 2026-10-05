/**
 * What a verifier sees: one claim and the sources it cites, nothing else. No commentary prose,
 * no translation notes, no provenance, no generator `sensitive` flag. Web sources carry the text
 * fetched from their URL for this check (trimmed around the excerpt when it can be found); that
 * text goes to the model only and is never written to the result.
 */
import type { SourceFetcher } from '@lectio/providers';
import type { Passage, PassageClaim, PassageSource } from '@lectio/schema/passage';

/** Characters of fetched text a verifier sees per source. */
export const MAX_FETCHED_CHARS = 4000;

export interface SourceInput {
  readonly id: string;
  readonly type: PassageSource['type'];
  readonly citation: string;
  readonly ref?: string;
  readonly url?: string;
  readonly excerpt?: string;
  readonly excerptLang?: string;
  readonly fetchedText?: string;
}

export interface ClaimInput {
  readonly claim: { readonly id: string; readonly text: string };
  readonly sources: readonly SourceInput[];
}

/** Fetched text by source URL (`undefined` text when the page could not be fetched). */
export type FetchedTexts = ReadonlyMap<string, string | undefined>;

/**
 * Up to `max` characters of `text`: a window centred on the excerpt when the excerpt (or its
 * first words) occurs in the text, otherwise the start of the text.
 */
export function trimFetched(text: string, excerpt: string | undefined, max = MAX_FETCHED_CHARS): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const needle = excerpt?.replace(/\s+/g, ' ').trim().split(' ').slice(0, 6).join(' ').toLowerCase();
  const at = needle === undefined || needle === '' ? -1 : clean.toLowerCase().indexOf(needle);
  const start = at < 0 ? 0 : Math.max(0, Math.min(at - Math.floor(max / 2), clean.length - max));
  return clean.slice(start, start + max);
}

/** Fetches the text of every web source of `passage` with a URL, once per URL. */
export async function fetchSourceTexts(
  passage: Passage,
  fetcher: SourceFetcher,
): Promise<Map<string, string | undefined>> {
  const texts = new Map<string, string | undefined>();
  for (const source of passage.sources) {
    if (source.type !== 'web' || source.url === undefined || texts.has(source.url)) continue;
    try {
      const fetched = await fetcher.fetch(
        source.url,
        source.archivedUrl === undefined ? {} : { archivedUrl: source.archivedUrl },
      );
      texts.set(source.url, fetched.status < 400 && fetched.text.trim() !== '' ? fetched.text : undefined);
    } catch {
      // A page that cannot be fetched is the evidence gate's concern; the verifier judges without it.
      texts.set(source.url, undefined);
    }
  }
  return texts;
}

function sourceInput(source: PassageSource, fetched: FetchedTexts): SourceInput {
  const text = source.url === undefined ? undefined : fetched.get(source.url);
  return {
    id: source.id,
    type: source.type,
    citation: source.citation,
    ...(source.ref === undefined ? {} : { ref: source.ref }),
    ...(source.url === undefined ? {} : { url: source.url }),
    ...(source.excerpt === undefined ? {} : { excerpt: source.excerpt }),
    ...(source.excerptLang === undefined ? {} : { excerptLang: source.excerptLang }),
    ...(text === undefined ? {} : { fetchedText: trimFetched(text, source.excerpt) }),
  };
}

/** The verifier input for `claim`: its id and text, and each cited source that exists in `passage`. */
export function claimInput(claim: PassageClaim, passage: Passage, fetched: FetchedTexts): ClaimInput {
  const byId = new Map(passage.sources.map((source) => [source.id, source]));
  const sources = claim.sourceIds.flatMap((id) => {
    const source = byId.get(id);
    return source === undefined ? [] : [sourceInput(source, fetched)];
  });
  return { claim: { id: claim.id, text: claim.text }, sources };
}
