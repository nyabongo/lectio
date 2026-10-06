/**
 * Notes in the reader's language (L-113): which passages a `/<locale>/` page shows translated, and the content
 * repository view every localised page, image, search document and API file reads.
 *
 * Translations live at `passages/i18n/<locale>/<key>.json` (L-112, docs/content-model.md). A page in another
 * locale shows a translation only when it is **approved** and **fresh** (its `sourceSha256` equals
 * `translatableSha256` of the English passage now) and lines up with the English notes and claims; otherwise it
 * shows the English notes, which keep `locale: 'en'` so pages mark them `lang="en"` and label them "English only".
 *
 * `localeRepo()` wraps a `ContentRepo` so that `passage()`, `resolveDay()` and `listDays()` return each approved
 * English passage with its translated prose laid over it: the summary, context, note anchors, glosses, summaries
 * and bodies, claim texts, and the review block (the translation's own approval and date). Everything else (keys,
 * references, verses, original-language words and sources) stays the English file's, so citations and permalinks
 * are the same in every language. The view
 * models (`readingView`, `dayView`, the API documents, the share cards) need no other change.
 *
 * Reading text is never involved: translations hold commentary only.
 */
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { TRANSLATIONS_DIR, checkTranslatedPassage, nodeFs, parseJson } from '@lectio/content';
import type { ContentFs, ContentRepo, ResolvedDay } from '@lectio/content';
import { SWAHILI_BOOKS } from '@lectio/audio';
import { formatRef, getBook, tryParseRef } from '@lectio/refs';
import type { BookCode } from '@lectio/refs';
import type { Passage, PassageClaim, TranslationNote } from '@lectio/schema/passage';
import { translatableSha256, translationMismatches } from '@lectio/schema/translated-passage';
import type { TranslatedClaim, TranslatedNote, TranslatedPassage } from '@lectio/schema/translated-passage';

import { siteContext } from './site.ts';

/**
 * Whether a passage is shown translated in a locale: `translated` (approved, fresh and complete), or why the English
 * notes are shown instead: `missing` (no file), `unapproved` (still pending review), `stale` (the English changed
 * since it was translated) or `mismatch` (its notes or claims no longer line up with the English ones).
 */
export type TranslationStatus = 'translated' | 'missing' | 'unapproved' | 'stale' | 'mismatch';

/** The status of `translation` against `english` as it is now. */
export function translationStatus(
  english: Passage,
  translation: TranslatedPassage | null | undefined,
): TranslationStatus {
  if (translation === null || translation === undefined) return 'missing';
  if (translation.review.status !== 'approved') return 'unapproved';
  if (translation.sourceSha256 !== translatableSha256(english)) return 'stale';
  return translationMismatches(english, translation).length > 0 ? 'mismatch' : 'translated';
}

/**
 * `english` with the prose of `translation` laid over it, and `locale` set to the translation's. Ids, references,
 * verses, original-language words and sources stay the English passage's; the review block is the translation's
 * (`translationReview`). A note or claim the
 * translation lacks (only possible for a `mismatch`, which `passageInLocale` never lays over) keeps its English text,
 * and a note without a translated anchor keeps the English one.
 */
export function overlayTranslation(english: Passage, translation: TranslatedPassage): Passage {
  const overlaid = overlay(english, translation);
  const source = { english, translation };
  overlays.set(overlaid, source);
  latestOverlays.set(overlayKey(overlaid), { passage: overlaid, source });
  return overlaid;
}

/** What a passage made by `overlayTranslation` was laid over: the English passage and its translation. */
export interface TranslationOverlay {
  readonly english: Passage;
  readonly translation: TranslatedPassage;
}

/** The source of each passage `overlayTranslation` returned, by identity (the fast path). */
const overlays = new WeakMap<Passage, TranslationOverlay>();

/**
 * The latest overlay of each passage key in each locale, so that a copy of an overlaid passage (a spread, a
 * `structuredClone`) still finds its source: by key, then checked field by field against the copy. One entry per
 * key and locale, replaced by the next overlay.
 */
const latestOverlays = new Map<string, { readonly passage: Passage; readonly source: TranslationOverlay }>();

const overlayKey = (passage: Pick<Passage, 'locale' | 'key'>): string => `${passage.locale}/${passage.key}`;

/**
 * The English passage and translation behind `passage` when `overlayTranslation` made it (or it is an unchanged
 * copy of one it made), else `undefined`. The narration (`./audio.ts`) needs both to speak a translation exactly as
 * the render pipeline and the web player do. A copy is matched by its key and locale and must equal the overlay in
 * every field, so a passage that merely shares the key (the English one, or one that was edited) is not taken for it.
 */
export function overlaySource(passage: Passage): TranslationOverlay | undefined {
  const found = overlays.get(passage);
  if (found !== undefined) return found;
  const latest = latestOverlays.get(overlayKey(passage));
  // Compared on every call (not cached by identity), so a copy edited later is not taken for the overlay. A JSON
  // round trip drops `undefined` fields, so such a copy may not match and gets no source: the safe direction.
  if (latest === undefined || !isDeepStrictEqual(latest.passage, passage)) return undefined;
  return latest.source;
}

function overlay(english: Passage, translation: TranslatedPassage): Passage {
  // Typed through the schema types by name: `astro check` sees the inferred schema types as `any`.
  const notes = new Map<string, TranslatedNote>(
    translation.translationNotes.map((note: TranslatedNote): [string, TranslatedNote] => [note.id, note]),
  );
  const claims = new Map<string, string>(
    translation.claims.map((claim: TranslatedClaim): [string, string] => [claim.id, claim.text]),
  );
  return {
    ...english,
    locale: translation.locale,
    summary: translation.summary,
    context: { title: translation.context.title, paragraphs: [...translation.context.paragraphs] },
    translationNotes: english.translationNotes.map((note: TranslationNote) => {
      const translated = notes.get(note.id);
      if (translated === undefined) return note;
      return {
        ...note,
        anchor: translated.anchor ?? note.anchor,
        original: { ...note.original, gloss: translated.gloss },
        summary: translated.summary,
        body: translated.body,
      };
    }),
    claims: english.claims.map((claim: PassageClaim) => ({ ...claim, text: claims.get(claim.id) ?? claim.text })),
    review: translationReview(english, translation),
  };
}

/**
 * The review block the shown text carries: an approved translation's own review (always by a person: who, how and
 * when the Kiswahili was approved), so the "last reviewed" date next to Kiswahili notes is the translation's. A
 * translation that is not approved keeps the English review (it is never laid over a page; see `passageInLocale`).
 */
function translationReview(english: Passage, translation: TranslatedPassage): Passage['review'] {
  const { status, reviewers, approvedVia, lastReviewedAt } = translation.review;
  if (status !== 'approved') return english.review;
  return {
    status,
    method: 'human',
    reviewers: [...reviewers],
    approvedVia: approvedVia as NonNullable<typeof approvedVia>,
    ...(lastReviewedAt === undefined ? {} : { lastReviewedAt }),
  } as Passage['review'];
}

/** A passage as a page in some locale shows it, and whether that is a translation. */
export interface LocalisedPassage {
  readonly passage: Passage;
  readonly status: TranslationStatus;
}

/**
 * The passage a page in another locale shows: the translation laid over the English passage when it is
 * `translated` (see `translationStatus`), else the English passage itself (its `locale` stays `en`).
 */
export function passageInLocale(english: Passage, translation: TranslatedPassage | null | undefined): LocalisedPassage {
  const status = translationStatus(english, translation);
  return {
    passage: status === 'translated' ? overlayTranslation(english, translation as TranslatedPassage) : english,
    status,
  };
}

/** Looks up the translation of passage `key` in `locale`: the validated file, or `null` when there is none. */
export type TranslationSource = (locale: string, key: string) => TranslatedPassage | null;

function isMissing(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === 'ENOENT';
}

/**
 * Reads translations from `passages/i18n/<locale>/<key>.json` under `root`, validating each against its schema and
 * path on first use (an invalid file fails the build with a `ContentError`); lookups are cached.
 */
export function translationSource(root: string, fs: ContentFs = nodeFs): TranslationSource {
  const cache = new Map<string, TranslatedPassage | null>();
  return (locale, key) => {
    const file = `${TRANSLATIONS_DIR}/${locale}/${key}.json`;
    if (cache.has(file)) return cache.get(file) as TranslatedPassage | null;
    let text: string | null;
    try {
      text = fs.readFile(join(root, file));
    } catch (error) {
      if (!isMissing(error)) throw error;
      text = null;
    }
    const translation = text === null ? null : checkTranslatedPassage(parseJson(text, file), file, { locale, key });
    cache.set(file, translation);
    return translation;
  };
}

export interface LocaleRepoOptions {
  /** The site's default locale (its notes are the English files themselves). Defaults to `en`. */
  readonly defaultLocale?: string;
  /** Where translations come from; defaults to `translationSource(repo.root)`. */
  readonly translations?: TranslationSource;
}

/**
 * `repo` as a page in `locale` reads it: every approved passage is `passageInLocale` of its translation in `locale`
 * (`passage()`, `resolveDay()` and `listDays()`); pending passages are left alone, so they stay unpublished. For the
 * default locale it is `repo` itself.
 */
export function localeRepo(repo: ContentRepo, locale: string, options: LocaleRepoOptions = {}): ContentRepo {
  if (locale === (options.defaultLocale ?? 'en')) return repo;
  const translations = options.translations ?? translationSource(repo.root);
  const localised = new Map<Passage, Passage>();
  const localise = (passage: Passage | null): Passage | null => {
    if (passage?.review.status !== 'approved') return passage;
    let shown = localised.get(passage);
    if (shown === undefined) {
      shown = passageInLocale(passage, translations(locale, passage.key)).passage;
      localised.set(passage, shown);
    }
    return shown;
  };
  const localiseDay = (day: ResolvedDay): ResolvedDay => ({
    ...day,
    masses: day.masses.map((mass) => ({
      ...mass,
      readings: mass.readings.map((reading) => ({ ...reading, passage: localise(reading.passage) })),
    })),
  });
  return {
    root: repo.root,
    calendarYear: (year) => repo.calendarYear(year),
    years: () => repo.years(),
    passage: (key) => localise(repo.passage(key)),
    passageKeys: () => repo.passageKeys(),
    resolveDay: (date) => {
      const day = repo.resolveDay(date);
      return day === null ? null : localiseDay(day);
    },
    listDays: (from, to) => repo.listDays(from, to).map(localiseDay),
    datesForPassage: (key) => repo.datesForPassage(key),
  };
}

const siteRepos = new Map<string, ContentRepo>();

/** The build's content repository (`siteContext().repo`) as pages in `locale` read it; one per locale per build. */
export function siteRepo(locale: string): ContentRepo {
  const { config, repo } = siteContext();
  let localised = siteRepos.get(locale);
  if (localised === undefined || localised.root !== repo.root) {
    localised = localeRepo(repo, locale, { defaultLocale: config.site.defaultLocale });
    siteRepos.set(locale, localised);
  }
  return localised;
}

/**
 * A book's name in Kiswahili prose (Biblia Takatifu, `SWAHILI_BOOKS` in @lectio/audio): the spoken name
 * (`Mathayo`, `Matendo ya Mitume`), or for a numbered book its written form (`1 Wakorintho`, not
 * `Wakorintho wa Kwanza`).
 */
export function swahiliBookName(code: BookCode): string {
  const { spoken, written } = SWAHILI_BOOKS[code];
  return /^[1-3]/.test(code) ? (written[0] as string) : spoken;
}

/** Long book names by locale, for locales whose prose does not use the English ones. */
const BOOK_NAMES: Readonly<Record<string, (code: BookCode) => string>> = { sw: swahiliBookName };

/** A book's name in `locale`'s prose: `Mathayo` in Kiswahili, `Matthew` (the English name) otherwise. */
export function bookNameIn(locale: string, code: BookCode): string {
  return BOOK_NAMES[locale]?.(code) ?? getBook(code).name;
}

/**
 * A calendar reference written in full in `locale`: `Mt 20:1-16a` is `Matthew 20:1–16a` in English and
 * `Mathayo 20:1–16a` in Kiswahili. A reference that does not parse is returned as it is.
 */
export function refLabelIn(locale: string, ref: string): string {
  const parsed = tryParseRef(ref);
  if (!parsed.ok) return ref;
  const long = formatRef(parsed.value, { style: 'long' });
  const book = getBook(parsed.value.book);
  const name = BOOK_NAMES[locale];
  const english = book.code === 'PS' ? 'Psalm' : book.name;
  // `formatRef` writes the long form as `<name> <chapters>`.
  return name === undefined ? long : `${name(book.code)}${long.slice(english.length)}`;
}
