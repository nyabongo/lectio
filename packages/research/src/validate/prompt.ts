/**
 * The self-repair request: the draft research output and the gate failures it produced, sent to
 * the `repair` model, which answers with the whole corrected output (same response schema as the
 * research call).
 */
import type { LectioConfig } from '@lectio/config';
import type { LlmRequest, LlmTool } from '@lectio/providers';

import { MAX_TRANSLATION_NOTES, RESEARCH_RESPONSE_SCHEMA, excerptWordLimit } from '../agent/schema.ts';

/** Recorded in the run report next to each repair. */
export const REPAIR_PROMPT_VERSION = 'repair-v1';

/** The repair call may re-read a source to fix an excerpt, but it does not research again. */
export const DEFAULT_REPAIR_TOOLS: readonly LlmTool[] = [{ kind: 'web_fetch', maxUses: 6 }];

/** Output token cap of a repair call (the whole output is written again). */
export const DEFAULT_REPAIR_MAX_TOKENS = 16_000;

export interface RepairInput {
  readonly key: string;
  readonly ref: string;
  /** The draft as the model last wrote it: the parsed output, or its raw text when it was not JSON. */
  readonly output: unknown;
  /** What is wrong, one problem per entry (gate findings with their rule and fix). */
  readonly problems: readonly string[];
  /** 1 for the first repair. */
  readonly attempt: number;
}

export interface RepairOptions {
  readonly config: Pick<LectioConfig, 'research' | 'licenceGuard'>;
  readonly tools?: readonly LlmTool[];
  readonly maxTokens?: number;
}

/** The system prompt of a repair call. */
export function repairSystemPrompt(config: Pick<LectioConfig, 'licenceGuard'>): string {
  return [
    'You repair a draft of Lectio research: commentary on one lectionary passage, written as JSON.',
    'Automated gates checked the draft and reported the problems listed in the user message. Fix every one of them',
    'and change nothing else. Return the whole corrected draft, matching the response schema exactly.',
    '',
    'Rules that still apply:',
    '- Every sentence of a context paragraph or note body ends with one or more claim markers such as [c1].',
    '- Every claim cites at least one source, and every source is cited by a claim. Keep existing claim ids.',
    `- At most ${String(MAX_TRANSLATION_NOTES)} translation notes; original-language text is spelt as in the verse it quotes.`,
    `- A verbatim excerpt is at most ${String(excerptWordLimit(config.licenceGuard))} words and appears on its source as quoted.`,
    '- Never copy the wording of an English Bible translation; write commentary in your own words.',
    '- When a claim cannot be supported, remove the claim and the sentences that cite it rather than invent a source.',
    '',
    'Pointers in the problems refer to the assembled passage file, which wraps your output with its key, reference,',
    'locale, note ids, provenance and review block; note, claim and source indices are the same as in your output.',
  ].join('\n');
}

function draftText(output: unknown): string {
  return typeof output === 'string' ? output : JSON.stringify(output, null, 2);
}

/** The user message of a repair call. */
export function repairUserMessage(input: RepairInput): string {
  return [
    `Passage ${input.key} (${input.ref}), repair ${String(input.attempt)}.`,
    '',
    'Problems:',
    ...input.problems.map((problem) => `- ${problem.replace(/\n/gu, '\n  ')}`),
    '',
    'Current draft:',
    '```json',
    draftText(input.output),
    '```',
  ].join('\n');
}

/** The `repair`-role request for one repair. */
export function buildRepairRequest(input: RepairInput, options: RepairOptions): LlmRequest {
  return {
    role: 'repair',
    system: repairSystemPrompt(options.config),
    messages: [{ role: 'user', content: repairUserMessage(input) }],
    tools: options.tools ?? DEFAULT_REPAIR_TOOLS,
    responseSchema: RESEARCH_RESPONSE_SCHEMA,
    model: options.config.research.models.repair.model,
    maxTokens: options.maxTokens ?? DEFAULT_REPAIR_MAX_TOKENS,
  };
}
