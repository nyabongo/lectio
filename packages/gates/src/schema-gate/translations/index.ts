/**
 * Gate 1 (schema) over translations (L-112): `passages/i18n/<locale>/<key>.json` files.
 *
 * For every translation the pull request adds, modifies or renames, under the content root:
 *
 * 1. the translated-passage schema (`schema/valid-translation`);
 * 2. its place and its English passage (`schema/translation-of-exists`);
 * 3. ids and claim markers line up with the English file (`schema/translation-matches-source`)
 *    and every sentence ends in a marker (`schema/sentence-cites-claim`);
 * 4. `sourceSha256` matches the English file now (`schema/translation-not-stale`, a warning);
 * 5. the licence guard's quoted-run limit on the translated text (`schema/translation-quoted-run`);
 * 6. provenance (`schema/no-fake-provenance`) and the review block: a pending translation is
 *    flagged for a person (`schema/translation-needs-review`, a warning), because translations never
 *    auto-merge; an approved one names configured reviewers (`schema/approved-has-reviewer`).
 *
 * When the pull request changes an English passage, every translation of it that the PR does not
 * touch is checked for staleness (a warning on that translation) or, when the English passage is
 * deleted or renamed, reported as orphaned (a rename is read through its old path too).
 *
 * Every other file the PR adds under passages/ must sit at a canonical path
 * (`schema/translation-path`): a case variant such as `passages/I18N/sw/…`, an English or malformed
 * locale, a nested directory or another subdirectory would otherwise escape these checks, the
 * licence gate's translation scan and the merge rule's translation hold.
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import type { LicenceGuardConfig } from '@lectio/config';
import { checkPassage, issuesFromAjv, parseJson } from '@lectio/content';
import type { ContentError } from '@lectio/content';
import { localeSchema } from '@lectio/schema/common';
import type { Passage } from '@lectio/schema/passage';
import {
  SOURCE_LOCALE_PATTERN,
  TRANSLATIONS_DIR,
  parseTranslatedPassagePath,
  translatableSha256,
  translatedPassagePath,
  translationMismatches,
  validateTranslatedPassage,
} from '@lectio/schema/translated-passage';
import type { TranslatedPassage } from '@lectio/schema/translated-passage';

import type { GateContext } from '../../core/gate.ts';
import type { ChangedFile } from '../../core/git.ts';
import { finding } from '../../core/result.ts';
import type { GateResultItem } from '../../core/result.ts';
import { englishWordCount, maskMarkers, preview, quotedSpans } from '../../licence-gate/text.ts';
import { SCHEMA_RULES } from '../rules.ts';
import { MARKER_FORMAT, citedSentences, excerpt } from '../sentences.ts';
import { TRANSLATION_RULES } from './rules.ts';

export { TRANSLATION_RULES } from './rules.ts';

type Push = (item: GateResultItem) => void;

/** Lists the translation locales present under the content root (directory names of passages/i18n). */
export type ListLocales = (context: GateContext, prefix: string) => readonly string[];

/** The directories of `<root>/<prefix>passages/i18n`; none when it does not exist. */
export const fsListLocales: ListLocales = (context, prefix) => {
  try {
    return readdirSync(join(context.root, prefix, TRANSLATIONS_DIR), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
};

export interface CheckTranslationsOptions {
  /** Defaults to {@link fsListLocales}. */
  readonly listLocales?: ListLocales;
}

/** `passages/<key>.json` (relative to the content root) → key, else `null`. */
export function englishKeyOf(relative: string): string | null {
  const match = /^passages\/([^/]+)\.json$/.exec(relative);
  return match === null ? null : (match[1] as string);
}

const PASSAGES = 'passages/';
const I18N = 'i18n/';
const LOCALE = new RegExp(localeSchema.pattern);
const SOURCE_LOCALE = new RegExp(SOURCE_LOCALE_PATTERN);

/** Why a path under passages/i18n/ (spelled correctly) is not a translation path. */
function translationPathProblem(rest: string): string {
  const parts = rest.slice(I18N.length).split('/');
  if (parts.length !== 2) return 'a translation sits exactly one locale directory below passages/i18n/';
  const [locale, name] = parts as [string, string];
  if (!name.endsWith('.json')) return 'a translation is a .json file (lower-case extension)';
  if (!LOCALE.test(locale) || SOURCE_LOCALE.test(locale))
    return `"${locale}" is not a translation locale (a BCP 47 tag such as sw or pt-BR, never English)`;
  return `"${name.slice(0, -'.json'.length)}" is not a passage key`;
}

/**
 * Why a file is misplaced under passages/ (matched in any letter case), or `null` when it is not
 * under passages/, is a file directly in it, or is a canonical translation path. `path` is
 * repository-relative; `prefix` is the content-root prefix (`""` or `"content/"`).
 */
export function misplacedContentFile(path: string, prefix: string): string | null {
  const base = `${prefix}${PASSAGES}`;
  if (!path.toLowerCase().startsWith(base.toLowerCase())) return null;
  if (!path.startsWith(base)) return `the directory must be spelled ${base} exactly, in lower case`;
  const rest = path.slice(base.length);
  const slash = rest.indexOf('/');
  if (slash < 0) {
    const json = rest.toLowerCase().endsWith('.json') && !rest.endsWith('.json');
    return json ? 'a passage is a .json file (lower-case extension)' : null;
  }
  const dir = rest.slice(0, slash);
  if (dir.toLowerCase() !== 'i18n')
    return `${base}${dir}/ is not a content directory: only ${base}i18n/ may hold files`;
  if (dir !== 'i18n') return `the translation directory must be spelled ${base}i18n/ exactly, in lower case`;
  if (parseTranslatedPassagePath(`${PASSAGES}${rest}`) !== null) return null;
  return translationPathProblem(rest);
}

function checkPath(push: Push, file: string, prefix: string): void {
  const problem = misplacedContentFile(file, prefix);
  if (problem === null) return;
  push(
    finding(TRANSLATION_RULES.translationPath, {
      file,
      message: `${file} is not a passage or translation path: ${problem}. Translations live at ${prefix}${TRANSLATIONS_DIR}/<locale>/<key>.json`,
    }),
  );
}

/** The English passage at the PR head: the passage, `missing`, or `invalid`. */
type English = { readonly passage: Passage } | { readonly problem: 'missing' | 'invalid' };

function readEnglish(context: GateContext, prefix: string, key: string): English {
  const path = `${prefix}passages/${key}.json`;
  const text = context.readFile(path);
  if (text === null) return { problem: 'missing' };
  try {
    return { passage: checkPassage(parseJson(text, path), path, key) };
  } catch {
    return { problem: 'invalid' };
  }
}

function englishProblem(push: Push, file: string, key: string, problem: 'missing' | 'invalid'): void {
  push(
    finding(TRANSLATION_RULES.translationOfExists, {
      file,
      pointer: '/translationOf',
      message:
        problem === 'missing'
          ? `the English passage passages/${key}.json does not exist`
          : `the English passage passages/${key}.json is not a valid passage, so the translation cannot be checked against it`,
    }),
  );
}

/** Where a renamed English passage went: the new path, and its key (`null` when it left passages/). */
interface Rename {
  readonly to: string;
  readonly key: string | null;
}

function renamedAway(push: Push, file: string, from: string, locale: string, rename: Rename): void {
  const what = `the English passage passages/${from}.json was renamed to ${rename.to}`;
  push(
    finding(TRANSLATION_RULES.translationOfExists, {
      file,
      pointer: '/translationOf',
      message:
        rename.key === null
          ? `${what}, which is not a passage, so this translation is orphaned: restore the English passage or delete the translation`
          : `${what}: move this translation to ${translatedPassagePath(locale, rename.key)} and set translationOf to "${rename.key}"`,
    }),
  );
}

function staleFinding(file: string, translation: TranslatedPassage, english: Passage): GateResultItem | null {
  if (translation.sourceSha256 === translatableSha256(english)) return null;
  return finding(TRANSLATION_RULES.translationNotStale, {
    file,
    pointer: '/sourceSha256',
    severity: 'warning',
    message: `the English passage ${english.key} changed since this ${translation.locale} translation was made`,
  });
}

/** Every prose field of a translation, markers blanked out, for the quoted-run check. */
function translatedFields(translation: TranslatedPassage): { pointer: string; text: string }[] {
  const fields: { pointer: string; text: string }[] = [
    { pointer: '/summary', text: translation.summary },
    { pointer: '/context/title', text: translation.context.title },
    ...translation.context.paragraphs.map((text, i) => ({ pointer: `/context/paragraphs/${String(i)}`, text })),
  ];
  translation.translationNotes.forEach((note, i) => {
    const base = `/translationNotes/${String(i)}`;
    fields.push(
      { pointer: `${base}/summary`, text: note.summary },
      { pointer: `${base}/body`, text: note.body },
      { pointer: `${base}/gloss`, text: note.gloss },
    );
  });
  translation.claims.forEach((claim, i) => fields.push({ pointer: `/claims/${String(i)}/text`, text: claim.text }));
  return fields.map((field) => ({ pointer: field.pointer, text: maskMarkers(field.text) }));
}

function checkQuotes(push: Push, file: string, translation: TranslatedPassage, limits: LicenceGuardConfig): void {
  for (const field of translatedFields(translation)) {
    for (const span of quotedSpans(field.text)) {
      const count = englishWordCount(field.text.slice(span.start, span.end));
      if (count <= limits.maxQuotedWords) continue;
      push(
        finding(TRANSLATION_RULES.translationQuotedRun, {
          file,
          pointer: field.pointer,
          message:
            `quotes ${String(count)} words (limit ${String(limits.maxQuotedWords)}): ` +
            `“${preview(field.text, span.start, span.end)}”. Lectio links out for the reading text in every language.`,
        }),
      );
    }
  }
}

function checkSentences(push: Push, file: string, translation: TranslatedPassage): void {
  const texts: [string, string][] = [
    ...translation.context.paragraphs.map((text, i): [string, string] => [`/context/paragraphs/${String(i)}`, text]),
    ...translation.translationNotes.map((note, i): [string, string] => [
      `/translationNotes/${String(i)}/body`,
      note.body,
    ]),
  ];
  for (const [pointer, text] of texts) {
    for (const sentence of citedSentences(text, translation.locale)) {
      if (sentence.claimIds.length > 0) continue;
      push(
        finding(SCHEMA_RULES.sentenceCitesClaim, {
          file,
          pointer,
          message: `sentence “${excerpt(sentence.text)}” carries no claim marker (${MARKER_FORMAT})`,
        }),
      );
    }
  }
}

function checkProvenance(push: Push, file: string, translation: TranslatedPassage): void {
  const { provenance } = translation;
  if (provenance.generator === 'fake') {
    push(
      finding(SCHEMA_RULES.noFakeProvenance, {
        file,
        pointer: '/provenance/generator',
        message: 'provenance.generator is "fake": this translation came from the fake provider',
      }),
    );
  }
  provenance.models.forEach((model, index) => {
    if (model.toLowerCase() !== 'fake') return;
    push(
      finding(SCHEMA_RULES.noFakeProvenance, {
        file,
        pointer: `/provenance/models/${String(index)}`,
        message: 'provenance.models lists the fake model',
      }),
    );
  });
}

function checkReview(push: Push, file: string, translation: TranslatedPassage, context: GateContext): void {
  const { review } = translation;
  if (review.status === 'pending') {
    push(
      finding(TRANSLATION_RULES.translationNeedsReview, {
        file,
        pointer: '/review',
        severity: 'warning',
        message: `the ${translation.locale} translation of ${translation.translationOf} waits for a reviewer (translations never auto-merge)`,
      }),
    );
    return;
  }
  const configured = context.config.reviewer.githubHandles;
  const handles = new Set(configured.map((handle) => handle.toLowerCase()));
  review.reviewers.forEach((reviewer, index) => {
    if (handles.has(reviewer.toLowerCase())) return;
    const known = configured.length === 0 ? 'none' : configured.join(', ');
    push(
      finding(SCHEMA_RULES.approvedHasReviewer, {
        file,
        pointer: `/review/reviewers/${String(index)}`,
        message: `${JSON.stringify(reviewer)} is not in config.reviewer.githubHandles (${known})`,
      }),
    );
  });
}

/** Parses and validates a translation; reports schema problems and returns `null` when it is invalid. */
function parseTranslation(push: Push, file: string, text: string): TranslatedPassage | null {
  let value: unknown;
  try {
    value = parseJson(text, file);
  } catch (error) {
    // parseJson only throws ContentError.
    const { issues } = error as ContentError;
    for (const issue of issues) {
      push(finding(TRANSLATION_RULES.validTranslation, { file, pointer: issue.pointer, message: issue.message }));
    }
    return null;
  }
  if (validateTranslatedPassage(value)) return value;
  for (const issue of issuesFromAjv(validateTranslatedPassage.errors)) {
    push(finding(TRANSLATION_RULES.validTranslation, { file, pointer: issue.pointer, message: issue.message }));
  }
  return null;
}

/** Every finding for one translation file at the PR head. */
export function checkTranslationFile(
  context: GateContext,
  prefix: string,
  file: string,
  text: string,
): GateResultItem[] {
  const items: GateResultItem[] = [];
  const push: Push = (item) => items.push(item);
  const translation = parseTranslation(push, file, text);
  if (translation === null) return items;
  const place = parseTranslatedPassagePath(file.slice(prefix.length)) as { locale: string; key: string };
  if (translation.locale !== place.locale || translation.translationOf !== place.key) {
    const expected = translatedPassagePath(translation.locale, translation.translationOf);
    push(
      finding(TRANSLATION_RULES.translationOfExists, {
        file,
        pointer: translation.locale === place.locale ? '/translationOf' : '/locale',
        message: `a ${translation.locale} translation of ${translation.translationOf} belongs at ${expected}`,
      }),
    );
  }
  checkSentences(push, file, translation);
  checkQuotes(push, file, translation, context.config.licenceGuard);
  checkProvenance(push, file, translation);
  checkReview(push, file, translation, context);

  const english = readEnglish(context, prefix, translation.translationOf);
  if ('problem' in english) {
    englishProblem(push, file, translation.translationOf, english.problem);
    return items;
  }
  for (const mismatch of translationMismatches(english.passage, translation)) {
    push(finding(TRANSLATION_RULES.translationMatchesSource, { file, ...mismatch }));
  }
  const stale = staleFinding(file, translation, english.passage);
  if (stale !== null) push(stale);
  return items;
}

/**
 * The untouched translations of an English passage the PR changed: stale ones are flagged, and
 * when the English passage is gone (deleted, or renamed away: `rename`) they are reported as
 * orphaned, valid or not. An invalid translation of a passage that still exists is left alone: it
 * was checked when it landed.
 */
function checkDependents(
  context: GateContext,
  prefix: string,
  key: string,
  locales: readonly string[],
  checked: ReadonlySet<string>,
  rename: Rename | undefined,
): GateResultItem[] {
  const items: GateResultItem[] = [];
  const push: Push = (item) => items.push(item);
  const english = readEnglish(context, prefix, key);
  for (const locale of locales) {
    const file = `${prefix}${translatedPassagePath(locale, key)}`;
    if (checked.has(file)) continue;
    const text = context.readFile(file);
    if (text === null) continue;
    if ('problem' in english) {
      if (rename !== undefined && english.problem === 'missing') renamedAway(push, file, key, locale, rename);
      else englishProblem(push, file, key, english.problem);
      continue;
    }
    const translation = parseTranslation(() => undefined, file, text);
    if (translation === null) continue;
    const stale = staleFinding(file, translation, english.passage);
    if (stale !== null) items.push(stale);
  }
  return items;
}

/** The English key a rename moved away from, with where it went; `null` when the change is not one. */
function renameOf(change: ChangedFile, prefix: string): (Rename & { readonly from: string }) | null {
  const previous = change.previousPath;
  if (change.status !== 'renamed' || previous === undefined || !previous.startsWith(prefix)) return null;
  const from = englishKeyOf(previous.slice(prefix.length));
  const key = change.path.startsWith(prefix) ? englishKeyOf(change.path.slice(prefix.length)) : null;
  if (from === null || from === key) return null;
  return { from, to: change.path, key };
}

/** Every translation finding for the pull request, and how many translation files were checked. */
export function checkTranslations(
  context: GateContext,
  prefix: string,
  options: CheckTranslationsOptions = {},
): { items: GateResultItem[]; files: number } {
  const items: GateResultItem[] = [];
  const push: Push = (item) => items.push(item);
  const checked = new Set<string>();
  const englishKeys = new Set<string>();
  const renames = new Map<string, Rename>();
  for (const change of context.changedFiles) {
    if (change.status !== 'deleted') checkPath(push, change.path, prefix);
    const rename = renameOf(change, prefix);
    if (rename !== null) {
      englishKeys.add(rename.from);
      renames.set(rename.from, rename);
    }
    if (!change.path.startsWith(prefix)) continue;
    const relative = change.path.slice(prefix.length);
    const key = englishKeyOf(relative);
    if (key !== null) englishKeys.add(key);
    if (parseTranslatedPassagePath(relative) === null || change.status === 'deleted') continue;
    const text = context.readFile(change.path);
    if (text === null) continue;
    checked.add(change.path);
    items.push(...checkTranslationFile(context, prefix, change.path, text));
  }
  if (englishKeys.size > 0) {
    const locales = (options.listLocales ?? fsListLocales)(context, prefix);
    for (const key of englishKeys) {
      items.push(...checkDependents(context, prefix, key, locales, checked, renames.get(key)));
    }
  }
  return { items, files: checked.size };
}
