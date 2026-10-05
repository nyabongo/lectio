/**
 * Versioned prompt templates (`packages/research/prompts/<name>.md`).
 *
 * A template file has a `## System` section (the system prompt) and a `## User` section (the user
 * message), each with `{{placeholder}}`s. Its version is `<name>@<first 12 hex digits of the file's
 * sha256>`, so every edit to the file is a new version and `provenance.promptVersion` names exactly
 * the text the model saw.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { sha256Hex } from '@lectio/providers';

/** The research prompt this package uses today. */
export const RESEARCH_PROMPT = 'research-v1';

/** Directory holding the prompt files. */
export const PROMPTS_DIR = fileURLToPath(new URL('../../prompts/', import.meta.url));

/** Hex digits of the sha256 kept in a prompt version. */
export const PROMPT_HASH_LENGTH = 12;

export interface PromptTemplate {
  /** File stem, for example `research-v1`. */
  readonly name: string;
  /** `<name>@<sha256 prefix>`. */
  readonly version: string;
  readonly system: string;
  readonly user: string;
}

/** A prompt file that is malformed, or a placeholder without a value. */
export class PromptError extends Error {
  override readonly name = 'PromptError';
}

const NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SYSTEM_HEADING = /^## System[ \t]*$/m;
const USER_HEADING = /^## User[ \t]*$/m;
const PLACEHOLDER = /\{\{([A-Za-z][A-Za-z0-9]*)\}\}/g;

/** The version of a prompt file's content. */
export function promptVersion(name: string, content: string): string {
  return `${name}@${sha256Hex(content).slice(0, PROMPT_HASH_LENGTH)}`;
}

/** Splits a prompt file into its system and user sections. */
export function parsePromptTemplate(name: string, content: string): PromptTemplate {
  if (!NAME.test(name)) throw new PromptError(`invalid prompt name: ${JSON.stringify(name)}`);
  const system = SYSTEM_HEADING.exec(content);
  const user = USER_HEADING.exec(content);
  if (system === null || user === null || user.index < system.index) {
    throw new PromptError(`${name}: a prompt file needs a "## System" section followed by a "## User" section`);
  }
  const systemText = content.slice(system.index + system[0].length, user.index).trim();
  const userText = content.slice(user.index + user[0].length).trim();
  if (systemText === '' || userText === '')
    throw new PromptError(`${name}: the System and User sections must not be empty`);
  return { name, version: promptVersion(name, content), system: systemText, user: userText };
}

export interface LoadPromptOptions {
  /** Directory of the prompt files. Default {@link PROMPTS_DIR}. */
  readonly dir?: string;
  /** Reads a file as UTF-8. Default node:fs. */
  readonly readFile?: (path: string) => Promise<string>;
}

/** Reads and parses `prompts/<name>.md`. */
export async function loadPromptTemplate(
  name: string = RESEARCH_PROMPT,
  options: LoadPromptOptions = {},
): Promise<PromptTemplate> {
  if (!NAME.test(name)) throw new PromptError(`invalid prompt name: ${JSON.stringify(name)}`);
  const read = options.readFile ?? ((path: string) => readFile(path, 'utf8'));
  const dir = options.dir ?? PROMPTS_DIR;
  const content = await read(`${dir.replace(/\/?$/, '/')}${name}.md`);
  return parsePromptTemplate(name, content);
}

/** Fills every `{{name}}`; a placeholder without a value is an error, never left in the prompt. */
export function renderTemplate(template: string, values: Readonly<Record<string, string | number>>): string {
  const missing = new Set<string>();
  const text = template.replace(PLACEHOLDER, (_match, key: string) => {
    const value = Object.hasOwn(values, key) ? values[key] : undefined;
    if (value === undefined) {
      missing.add(key);
      return '';
    }
    return String(value);
  });
  if (missing.size > 0) throw new PromptError(`no value for placeholder(s): ${[...missing].join(', ')}`);
  return text;
}
