/**
 * The verifier prompts, versioned as files in `packages/gates/prompts/` (`<name>.v<N>.md`). A
 * result records each prompt's id and the first 12 hex digits of its sha256, so a verdict can be
 * traced to the exact text the model saw. Changing a prompt means adding a new version file and
 * pointing {@link PROMPT_FILES} at it.
 */
import { readFileSync } from 'node:fs';

import { sha256Hex } from '@lectio/providers';

export type VerifierRole = 'confirmer' | 'refuter';

export const VERIFIER_ROLES: readonly VerifierRole[] = ['confirmer', 'refuter'];

/** The prompt file each verifier uses, relative to `packages/gates/prompts/`. */
export const PROMPT_FILES: Readonly<Record<VerifierRole, string>> = {
  confirmer: 'verifier-confirmer.v1.md',
  refuter: 'verifier-refuter.v1.md',
};

export interface VerifierPrompt {
  /** `verifier-confirmer.v1`: the file name without `.md`. */
  readonly id: string;
  /** First 12 hex digits of the sha256 of the prompt text. */
  readonly sha256: string;
  readonly text: string;
}

/** Reads a prompt file; tests inject their own. */
export type ReadPrompt = (file: string) => string;

const PROMPTS_DIR = new URL('../../prompts/', import.meta.url);

export const readPromptFile: ReadPrompt = (file) => readFileSync(new URL(file, PROMPTS_DIR), 'utf8');

/** The prompt for `role`, with its version. */
export function loadPrompt(role: VerifierRole, read: ReadPrompt = readPromptFile): VerifierPrompt {
  const file = PROMPT_FILES[role];
  const text = read(file);
  if (text.trim() === '') throw new Error(`verifier prompt ${file} is empty`);
  return { id: file.replace(/\.md$/, ''), sha256: sha256Hex(text).slice(0, 12), text };
}
