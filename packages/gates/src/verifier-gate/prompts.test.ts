import { describe, expect, it } from 'vitest';

import { sha256Hex } from '@lectio/providers';

import { PROMPT_FILES, VERIFIER_ROLES, loadPrompt, readPromptFile } from './prompts.ts';

describe('verifier prompts', () => {
  it.each(VERIFIER_ROLES)('the %s prompt is versioned and hashed', (role) => {
    const prompt = loadPrompt(role);
    const text = readPromptFile(PROMPT_FILES[role]);
    expect(prompt.id).toBe(PROMPT_FILES[role].replace(/\.md$/, ''));
    expect(prompt.id).toMatch(/\.v\d+$/);
    expect(prompt.sha256).toBe(sha256Hex(text).slice(0, 12));
    expect(prompt.text).toBe(text);
    expect(text).toContain('`sensitive`');
    expect(text).toContain('300 characters');
  });

  it('rejects an empty prompt', () => {
    expect(() => loadPrompt('refuter', () => ' \n')).toThrow('verifier prompt verifier-refuter.v1.md is empty');
  });
});
