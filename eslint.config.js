// ESLint flat config for the whole monorepo. New packages are linted without
// editing this file. Formatting is Prettier's job (eslint-config-prettier turns
// off the conflicting rules); run `npm run format` to fix it.
import { existsSync, readFileSync } from 'node:fs';

import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Coverage-ignore comments hide code from the 96% floor. This rule reports
 * them early; `npm run coverage:floor` (packages/shared/src/coverage-floor.ts,
 * same pattern) is the authoritative check, which an eslint-disable comment
 * cannot silence. Exceptions go in the owner-reviewed allowlist below.
 */
const COVERAGE_IGNORE_HINT = /\b(?:v8|c8|istanbul)\s+ignore\b/i;
const ALLOWLIST = '.github/coverage-ignore-allowlist.json';

/** Paths listed in the allowlist; a malformed file is left to coverage:floor to report. */
function allowlistedPaths() {
  const file = new URL(ALLOWLIST, import.meta.url);
  if (!existsSync(file)) return [];
  try {
    const { files } = JSON.parse(readFileSync(file, 'utf8'));
    return Array.isArray(files) ? files.map((entry) => entry?.path).filter((path) => typeof path === 'string') : [];
  } catch {
    return [];
  }
}

/** @type {import('eslint').Rule.RuleModule} */
const noCoverageIgnore = {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow v8/c8/istanbul coverage-ignore comments' },
    messages: {
      hint:
        "'{{hint}}' comments are not allowed; they hide code from the 96% coverage floor. " +
        `Test the code instead, or (owner review) list the file in ${ALLOWLIST} with a reason.`,
    },
    schema: [],
  },
  create(context) {
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          const match = COVERAGE_IGNORE_HINT.exec(comment.value);
          if (match && comment.loc) context.report({ loc: comment.loc, messageId: 'hint', data: { hint: match[0] } });
        }
      },
    };
  },
};

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/.astro/**',
      '**/__generated__/**',
      'apps/mobile/**',
      'corpus/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      eqeqeq: ['error', 'always'],
      'no-console': 'off',
    },
  },
  {
    files: ['packages/*/src/**', 'apps/*/src/**'],
    ignores: allowlistedPaths(),
    plugins: { lectio: { rules: { 'no-coverage-ignore': noCoverageIgnore } } },
    rules: { 'lectio/no-coverage-ignore': 'error' },
  },
  prettier,
);
