/**
 * Translating one English passage file into another language (L-112): one `LlmClient.generate`
 * call (no tools) that sees only the passage's translatable fields, then the assembler, then
 * `passages/i18n/<locale>/<key>.json`.
 *
 * The model returns the localised summary, context, note texts and claim texts under the English
 * ids. The assembler adds `translationOf`, `locale`, `sourceSha256` (the hash of what was
 * translated), provenance and a pending review block, validates the result against the
 * translated-passage schema and checks that ids and claim markers line up with the English file.
 * Sources are never sent or translated: the translation cites the English file's sources by claim.
 *
 * Like research, each translation spends on its own child of the run's cost meter, capped at
 * `research.budget.perPassageUsd`; going over aborts that translation cleanly.
 */
import { mkdir, writeFile as fsWriteFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { LectioConfig } from '@lectio/config';
import { BudgetExceededError, LlmOutputError, ProviderError, validateAgainstSchema } from '@lectio/providers';
import type { Clock, CostMeter, JsonSchema, LlmClient, LlmRequest } from '@lectio/providers';
import type { Passage } from '@lectio/schema/passage';
import {
  TRANSLATED_PASSAGE_SCHEMA_VERSION,
  translatableFields,
  translatableSha256,
  translatedPassagePath,
  translatedPassageSchema,
  translationMismatches,
  validateTranslatedPassage,
} from '@lectio/schema/translated-passage';
import type { TranslatedPassage } from '@lectio/schema/translated-passage';
import { formatErrors } from '@lectio/schema/common';

import { prettierJson } from '../agent/research.ts';

/** Version of the translation prompt below; recorded as `provenance.promptVersion`. */
export const TRANSLATE_PROMPT_VERSION = 'translate-v1';

/** Output token cap of the translation call. */
export const DEFAULT_TRANSLATE_MAX_TOKENS = 12_000;

/** Language names for the prompt; an unlisted locale is named by its tag. */
export const LANGUAGE_NAMES: Readonly<Record<string, string>> = {
  sw: 'Kiswahili (Swahili)',
};

/** The language name the prompt uses for `locale`. */
export function languageName(locale: string): string {
  return LANGUAGE_NAMES[locale] ?? locale;
}

const { properties } = translatedPassageSchema;

/** The JSON Schema sent as `responseSchema`: the localised fields of a translation file. */
export const TRANSLATE_RESPONSE_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'context', 'translationNotes', 'claims'],
  properties: {
    summary: properties.summary,
    context: properties.context,
    translationNotes: properties.translationNotes,
    claims: properties.claims,
  },
};

/** What the model returns (once it matches {@link TRANSLATE_RESPONSE_SCHEMA}). */
export type TranslateOutput = Pick<TranslatedPassage, 'summary' | 'context' | 'translationNotes' | 'claims'>;

/** The system prompt for a target language. */
export function translateSystemPrompt(locale: string): string {
  const language = languageName(locale);
  return [
    `You translate Catholic Bible-study commentary from English into ${language} (${locale}).`,
    'The commentary explains the historical context and the original-language words of one lectionary passage.',
    '',
    'Rules:',
    `- Translate every field faithfully into natural, plain ${language} for a general Catholic reader. Do not add, drop or soften any statement.`,
    '- Keep every id exactly as given (translation-note ids such as `evil-eye`, claim ids such as `c1`). Return every note and every claim, in the same order.',
    '- Keep the context paragraphs one for one.',
    '- Keep every claim marker (`[c1]`, `[c2][c3]`) exactly as written, after the same sentence. Every sentence ends with its marker(s); square brackets are only for markers.',
    '- Keep Greek, Hebrew, Aramaic and Latin words, transliterations, Bible references (`Mt 6:22-23`) and personal names as they are; write book abbreviations the way readers of this language expect.',
    `- Never quote a Bible translation in ${language} or in English beyond a single word or a short phrase. Lectio links out for the reading text and never reproduces it.`,
    `- \`gloss\` renders the meaning of the original words in ${language}.`,
    `- \`anchor\` is optional: give the word or short phrase (at most six words) that ${language} lectionaries commonly use at this point only when you are confident; otherwise leave it out.`,
    '- Return only JSON that matches the response schema.',
  ].join('\n');
}

/** The user message: the English passage's translatable fields, as JSON. */
export function translateUserPrompt(passage: Passage): string {
  return [
    `Translate the commentary for ${passage.ref} (${passage.key}).`,
    '',
    '```json',
    JSON.stringify(translatableFields(passage), null, 2),
    '```',
  ].join('\n');
}

export interface TranslateDeps {
  /** Builds an LLM client that charges `meter` (called once per passage with that passage's meter). */
  readonly llm: (meter: CostMeter) => LlmClient;
  /** The run's cost meter; each translation spends on a child scoped to `research.budget.perPassageUsd`. */
  readonly meter: CostMeter;
  readonly config: Pick<LectioConfig, 'research'>;
  readonly clock: Clock;
  readonly runId: string;
  /** Target locale, for example `sw`. */
  readonly locale: string;
  /** Content repository root: translations are written to `<contentRoot>/passages/i18n/<locale>/<key>.json`. */
  readonly contentRoot: string;
  readonly maxTokens?: number;
  /** Writes a file (parent directories exist). Default node:fs. */
  readonly writeFile?: (path: string, text: string) => Promise<void>;
  /** Formats the JSON the way the repository's Prettier check expects. Default Prettier. */
  readonly format?: (json: string, path: string) => Promise<string>;
}

/** Builds the translation request for one English passage. */
export function buildTranslateRequest(
  passage: Passage,
  deps: Pick<TranslateDeps, 'config' | 'locale' | 'maxTokens'>,
): LlmRequest {
  return {
    role: 'generator',
    system: translateSystemPrompt(deps.locale),
    messages: [{ role: 'user', content: translateUserPrompt(passage) }],
    responseSchema: TRANSLATE_RESPONSE_SCHEMA,
    model: deps.config.research.models.generator.model,
    maxTokens: deps.maxTokens ?? DEFAULT_TRANSLATE_MAX_TOKENS,
  };
}

export interface AssembleTranslationMeta {
  readonly locale: string;
  readonly runId: string;
  readonly models: readonly string[];
  /** `fake` output is marked `generator: 'fake'`, so gate 1 rejects it. */
  readonly family: string;
  readonly createdAt: string;
  readonly costUsd: number;
}

/** A translation that does not validate or does not line up with its English passage. */
export class TranslationInvalidError extends Error {
  override readonly name = 'TranslationInvalidError';
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super('the assembled translation is invalid');
    this.issues = issues;
  }
}

/** Builds and checks the translation file; throws `TranslationInvalidError` listing every problem. */
export function assembleTranslation(
  english: Passage,
  output: TranslateOutput,
  meta: AssembleTranslationMeta,
): TranslatedPassage {
  const translation: unknown = {
    translationOf: english.key,
    locale: meta.locale,
    sourceSha256: translatableSha256(english),
    summary: output.summary,
    context: output.context,
    translationNotes: output.translationNotes,
    claims: output.claims,
    provenance: {
      generator: meta.family === 'fake' ? 'fake' : 'research-cli',
      runId: meta.runId,
      models: [...new Set(meta.models)],
      promptVersion: TRANSLATE_PROMPT_VERSION,
      createdAt: meta.createdAt,
      costUsd: meta.costUsd,
    },
    review: { status: 'pending', reviewers: [] },
    schemaVersion: TRANSLATED_PASSAGE_SCHEMA_VERSION,
  };
  if (!validateTranslatedPassage(translation)) {
    throw new TranslationInvalidError(formatErrors(validateTranslatedPassage.errors));
  }
  const mismatches = translationMismatches(english, translation);
  if (mismatches.length > 0) {
    throw new TranslationInvalidError(mismatches.map((mismatch) => `${mismatch.pointer} ${mismatch.message}`));
  }
  return translation;
}

interface ResultBase {
  readonly key: string;
  /** What this translation spent, in USD. */
  readonly costUsd: number;
}

export interface TranslationWritten extends ResultBase {
  readonly status: 'written';
  /** Path under the content root, `passages/i18n/<locale>/<key>.json`. */
  readonly path: string;
  readonly translation: TranslatedPassage;
}

export interface TranslationOverBudget extends ResultBase {
  readonly status: 'over-budget';
  readonly meter: string;
  /** True when the run budget is spent, so no further translation can start. */
  readonly runExhausted: boolean;
}

export interface TranslationFailed extends ResultBase {
  readonly status: 'failed';
  readonly error: string;
  readonly issues: readonly string[];
  /** The model output, when there was one. */
  readonly output?: unknown;
}

export type TranslationResult = TranslationWritten | TranslationOverBudget | TranslationFailed;

async function defaultWriteFile(path: string, text: string): Promise<void> {
  await fsWriteFile(path, text, 'utf8');
}

/** Translates one English passage and writes its file. Unexpected (programming) errors are rethrown. */
export async function translatePassage(english: Passage, deps: TranslateDeps): Promise<TranslationResult> {
  const key = english.key;
  const meter = deps.meter.scope(`translate:${deps.locale}:${key}`, deps.config.research.budget.perPassageUsd);
  const spent = (): number => meter.spentUsd();
  let output: unknown;
  try {
    meter.assertWithinBudget();
    const response = await deps.llm(meter).generate(buildTranslateRequest(english, deps));
    output = response.output;
    const problems = validateAgainstSchema(TRANSLATE_RESPONSE_SCHEMA, output);
    if (problems.length > 0) {
      return {
        status: 'failed',
        key,
        costUsd: spent(),
        error: 'the model output does not match the translation schema',
        issues: problems,
        output,
      };
    }
    const translation = assembleTranslation(english, output as TranslateOutput, {
      locale: deps.locale,
      runId: deps.runId,
      models: [response.model],
      family: response.family,
      createdAt: deps.clock.now().toISOString(),
      costUsd: spent(),
    });
    const path = translatedPassagePath(deps.locale, key);
    const absolute = join(deps.contentRoot, path);
    const text = await (deps.format ?? prettierJson)(`${JSON.stringify(translation, null, 2)}\n`, absolute);
    await mkdir(dirname(absolute), { recursive: true });
    await (deps.writeFile ?? defaultWriteFile)(absolute, text);
    return { status: 'written', key, costUsd: spent(), path, translation };
  } catch (error) {
    if (error instanceof BudgetExceededError) {
      return {
        status: 'over-budget',
        key,
        costUsd: spent(),
        meter: error.meter,
        runExhausted: deps.meter.remainingUsd() <= 0,
      };
    }
    if (error instanceof TranslationInvalidError) {
      return { status: 'failed', key, costUsd: spent(), error: error.message, issues: error.issues, output };
    }
    if (error instanceof ProviderError) {
      return {
        status: 'failed',
        key,
        costUsd: spent(),
        error: error.message,
        issues: [`${error.code}: ${error.message}`],
        ...(error instanceof LlmOutputError ? { output: error.rawText } : {}),
      };
    }
    throw error;
  }
}
