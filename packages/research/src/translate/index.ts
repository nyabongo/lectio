/**
 * Translation (L-112): `npm run research -- translate --locale <tag> --from … --days …` turns
 * approved English passages into `passages/i18n/<locale>/<key>.json` files and opens one
 * needs-review PR per translation. Translations never auto-merge. The CLI entry point (L-038)
 * dispatches the `translate` subcommand to {@link runTranslate}.
 */
export { TRANSLATE_USAGE, parseTranslateArgs } from './args.ts';
export type { TranslateArgs } from './args.ts';
export { TRANSLATE_BRANCH_PREFIX, planTranslations, translationBranch } from './plan.ts';
export type {
  TranslationItem,
  TranslationPlan,
  TranslationPlanInput,
  TranslationSkipReason,
  TranslationSkipped,
} from './plan.ts';
export {
  TRANSLATION_LABEL,
  TRANSLATION_TRAILER,
  TranslationPublishRefusedError,
  isTranslationHead,
  publishTranslation,
  translationCommitMessage,
  translationPrBody,
  translationPrTitle,
} from './publish.ts';
export type {
  TranslationPublishItem,
  TranslationPublishOptions,
  TranslationPublishResult,
  TranslationRefusal,
} from './publish.ts';
export { formatTranslateReport, fsReadTranslation, runTranslate } from './run.ts';
export type { RunTranslateDeps, TranslatePublishOutcome, TranslateRunReport } from './run.ts';
export {
  DEFAULT_TRANSLATE_MAX_TOKENS,
  LANGUAGE_NAMES,
  TRANSLATE_PROMPT_VERSION,
  TRANSLATE_RESPONSE_SCHEMA,
  TranslationInvalidError,
  assembleTranslation,
  buildTranslateRequest,
  languageName,
  translatePassage,
  translateSystemPrompt,
  translateUserPrompt,
} from './translate.ts';
export type {
  AssembleTranslationMeta,
  TranslateDeps,
  TranslateOutput,
  TranslationFailed,
  TranslationOverBudget,
  TranslationResult,
  TranslationWritten,
} from './translate.ts';
