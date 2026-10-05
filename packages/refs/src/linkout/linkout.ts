import type { LinkoutConfig, LinkoutProvider } from '@lectio/config';

import { fromKey, isKey } from '../key.ts';
import { parseRef } from '../parse.ts';
import type { Ref } from '../types.ts';
import { checkRef } from '../validate.ts';
import { mapRef, SCHEMES } from '../versification/index.ts';
import type { Scheme } from '../versification/index.ts';
import { drboUrl } from './drbo.ts';
import { LinkoutError } from './errors.ts';
import { fillTemplate, templateTokens, templateValues } from './template.ts';

/** What {@link linkoutUrl} returns: the provider's config name, its display label and the URL. */
export interface Linkout {
  readonly provider: string;
  readonly label: string;
  readonly url: string;
}

/**
 * The versification lectionary references are written in. Lectio references
 * follow the Hebrew/Greek numbering of the NABRE lectionary (L-006 `original`).
 */
export const REFERENCE_SCHEME: Scheme = 'original';

/**
 * The link-out for a reading: the active provider of `config.linkout` applied
 * to `ref`. The reference is first mapped from {@link REFERENCE_SCHEME} to the
 * provider's `versification` (the built-in `drbo` provider uses `vulgate`, so
 * Ps 145 links to Ps 144). A reference spanning chapters links to its first
 * chapter. Builds a URL only; it never fetches anything.
 *
 * @param ref A parsed reference, a lectionary reference (`Mt 20:1-16a`) or a passage key (`MT.20.1-16`).
 * @param date The reading's date as `YYYY-MM-DD`, used by templates with `{date}`; may be omitted otherwise.
 * @param config Any object with a `linkout` section, usually the loaded `LectioConfig`.
 * @throws {LinkoutError} for an unknown, disabled or malformed provider entry, an unknown template token or a bad date.
 * @throws {RefError} for an invalid reference; {VersificationError} when it has no counterpart in the provider's numbering.
 */
export function linkoutUrl(
  ref: Ref | string,
  date: string | undefined,
  config: { readonly linkout: LinkoutConfig },
): Linkout {
  const name = config.linkout.provider;
  const provider = activeProvider(config.linkout);
  const target = mapRef(toRef(ref), REFERENCE_SCHEME, schemeOf(name, provider));
  return { provider: name, label: provider.label, url: buildUrl(name, provider, target, date) };
}

function toRef(ref: Ref | string): Ref {
  if (typeof ref !== 'string') {
    checkRef(ref);
    return ref;
  }
  return isKey(ref) ? fromKey(ref) : parseRef(ref);
}

/** The entry `linkout.provider` names; it must exist and be enabled. */
export function activeProvider(linkout: LinkoutConfig): LinkoutProvider {
  const name = linkout.provider;
  if (!Object.hasOwn(linkout.providers, name)) {
    const known = Object.keys(linkout.providers).join(', ');
    throw new LinkoutError('UNKNOWN_PROVIDER', `Link-out provider "${name}" is not in linkout.providers (${known})`);
  }
  const provider = linkout.providers[name] as LinkoutProvider;
  if (!provider.enabled) {
    throw new LinkoutError('DISABLED_PROVIDER', `Link-out provider "${name}" is disabled; set its enabled: true`);
  }
  return provider;
}

function schemeOf(name: string, provider: LinkoutProvider): Scheme {
  const scheme = provider.versification ?? REFERENCE_SCHEME;
  if (!(SCHEMES as readonly string[]).includes(scheme)) {
    throw new LinkoutError(
      'UNKNOWN_VERSIFICATION',
      `Link-out provider "${name}" uses versification "${scheme}"; use one of ${SCHEMES.join(', ')}`,
    );
  }
  return scheme as Scheme;
}

function buildUrl(name: string, provider: LinkoutProvider, ref: Ref, date: string | undefined): string {
  const { builtin, template } = provider;
  if (builtin !== undefined && template === undefined) {
    if (builtin === 'drbo') return drboUrl(ref);
    throw new LinkoutError(
      'INVALID_PROVIDER',
      `Link-out provider "${name}" names unknown builtin "${String(builtin)}"`,
    );
  }
  if (template === undefined || builtin !== undefined) {
    throw new LinkoutError(
      'INVALID_PROVIDER',
      `Link-out provider "${name}" must set exactly one of builtin or template`,
    );
  }
  if (date === undefined && templateTokens(template).includes('date')) {
    throw new LinkoutError('INVALID_DATE', `Link-out provider "${name}" uses {date}; pass the reading's date`);
  }
  return fillTemplate(template, templateValues(ref, date));
}
