/**
 * Reading a locale's translations from the content repository and turning every narratable one
 * into segments, for the render pipeline (the English counterpart is `approvedSegments` in
 * `../cli/run.ts`).
 */
import { join } from 'node:path';

import { TRANSLATIONS_DIR, checkTranslatedPassage, nodeFs, parseJson, translationPlaceOf } from '@lectio/content';
import type { ContentFs, ContentRepo } from '@lectio/content';
import type { TranslatedPassage } from '@lectio/schema/translated-passage';

import type { NarrationSegment } from '../script/segments.ts';
import { localeNarration, skipReason, translationSegments } from './segments.ts';
import type { LocaleNarration, NarratableOptions, SkipReason } from './segments.ts';

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}

/**
 * Every translation in `passages/i18n/<locale>/` under the repository root, validated against
 * its schema and path, in key order. A locale without a directory has none. An invalid file
 * throws, or, with `onInvalid`, is reported there (with the key its path names) and left out.
 */
export function loadTranslations(
  repo: ContentRepo,
  locale: string,
  fs: ContentFs = nodeFs,
  onInvalid?: (key: string, error: unknown) => void,
): TranslatedPassage[] {
  const dir = `${TRANSLATIONS_DIR}/${locale}`;
  let names: string[];
  try {
    names = fs.readdir(join(repo.root, dir));
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
  const translations: TranslatedPassage[] = [];
  for (const name of [...names].sort()) {
    const file = `${dir}/${name}`;
    const place = translationPlaceOf(file);
    if (place?.locale !== locale) continue;
    try {
      const value = parseJson(fs.readFile(join(repo.root, file)), file);
      translations.push(checkTranslatedPassage(value, file, place));
    } catch (error) {
      if (onInvalid === undefined) throw error;
      onInvalid(place.key, error);
    }
  }
  return translations;
}

/** A translation left out of the render, and why. */
export interface SkippedTranslation {
  readonly key: string;
  readonly locale: string;
  /** A {@link SkipReason}, or `invalid` for a file (or its English passage) that does not read. */
  readonly reason: SkipReason | 'invalid';
  /** What is wrong with an `invalid` one. */
  readonly message?: string;
}

export interface LocaleSegmentsResult {
  readonly segments: NarrationSegment[];
  readonly skipped: SkippedTranslation[];
}

export interface LocaleSegmentsOptions extends NarratableOptions {
  readonly narration?: LocaleNarration;
  readonly fs?: ContentFs;
}

/**
 * Segments for every narratable translation in `locale` (approved, fresh, of an approved English
 * passage), each passage under the `gospel` slot: the slot only labels the Listen queue and is not
 * part of the audio key. Translations that may not be narrated are listed with their reason; one
 * that does not read (or whose English passage does not) is listed as `invalid` and the rest are
 * still narrated, as the English path skips a passage it cannot narrate.
 */
export function localeSegments(
  repo: ContentRepo,
  locale: string,
  options: LocaleSegmentsOptions = {},
): LocaleSegmentsResult {
  const narration = options.narration ?? localeNarration(locale);
  const segments: NarrationSegment[] = [];
  const skipped: SkippedTranslation[] = [];
  const invalid = (key: string, error: unknown): void => {
    skipped.push({ key, locale, reason: 'invalid', message: (error as Error).message });
  };
  for (const translation of loadTranslations(repo, locale, options.fs, invalid)) {
    const key = translation.translationOf;
    try {
      const english = repo.passage(key);
      const reason = skipReason(english, translation, options);
      if (reason !== null) {
        skipped.push({ key, locale, reason });
        continue;
      }
      segments.push(
        ...translationSegments(english as NonNullable<typeof english>, translation, 'gospel', locale, narration),
      );
    } catch (error) {
      invalid(key, error);
    }
  }
  return { segments, skipped };
}
