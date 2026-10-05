// Every relative link and heading anchor in README.md, CONTRIBUTING.md, config/README.md and docs/**/*.md resolves (L-091). Offline: external links
// are not fetched. The fixtures prove the checker catches a missing file, a missing anchor (in another file and in
// the same file), an HTML link and a reference definition.
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { anchorsOf, checkFile, extractLinks, markdownFiles, slugify } from './links.ts';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const fixtures = fileURLToPath(new URL('fixtures', import.meta.url));

describe('repository docs', () => {
  const files = [
    ...['README.md', 'CONTRIBUTING.md', 'config/README.md'].map((file) => join(repoRoot, file)),
    ...markdownFiles(join(repoRoot, 'docs')),
  ];

  it('covers README.md, CONTRIBUTING.md, config/README.md, the operator handbook and the API reference', () => {
    const shown = files.map((file) => file.slice(repoRoot.length));
    expect(shown).toEqual(
      expect.arrayContaining([
        'README.md',
        'CONTRIBUTING.md',
        'config/README.md',
        'docs/operator-handbook.md',
        'docs/api.md',
      ]),
    );
  });

  it.each(files.map((file) => [file.slice(repoRoot.length), file]))('%s: every relative link resolves', (_, file) => {
    expect(checkFile(file, repoRoot)).toEqual([]);
  });
});

describe('the link checker', () => {
  it('accepts files, directories, anchors, repeated headings, HTML anchors and encoded paths', () => {
    expect(checkFile(join(fixtures, 'ok/README.md'), fixtures)).toEqual([]);
  });

  it('reports every broken link with its line and reason', () => {
    const broken = checkFile(join(fixtures, 'broken/README.md'), fixtures);
    expect(broken.map(({ line, target, reason }) => ({ line, target, reason }))).toEqual([
      { line: 3, target: 'nowhere.md', reason: 'no such file or directory: broken/nowhere.md' },
      {
        line: 4,
        target: '../ok/sub/page.md#no-such-heading',
        reason: 'no heading or anchor #no-such-heading in ok/sub/page.md',
      },
      { line: 5, target: '#no-such-heading', reason: 'no heading or anchor #no-such-heading in broken/README.md' },
      { line: 6, target: 'gone/', reason: 'no such file or directory: broken/gone' },
      { line: 8, target: 'missing-reference.md', reason: 'no such file or directory: broken/missing-reference.md' },
    ]);
    expect(broken.every(({ file }) => file === 'broken/README.md')).toBe(true);
  });

  it('skips code spans and fenced blocks, and unwraps <…> targets', () => {
    const markdown = ['`[a](x.md)` [b](<y z.md>)', '~~~', '[c](w.md)', '~~~', '[d](v.md "t")'].join('\n');
    expect(extractLinks(markdown)).toEqual([
      { line: 1, target: 'y z.md' },
      { line: 5, target: 'v.md' },
    ]);
  });

  it('slugs headings the way GitHub does', () => {
    expect(slugify('Fix-up mode')).toBe('fix-up-mode');
    expect(slugify('1 · schema')).toBe('1--schema');
    expect(slugify('Keys, defaults and decisions')).toBe('keys-defaults-and-decisions');
    expect(slugify('`npm run research` and [the runbook](x.md)')).toBe('npm-run-research-and-the-runbook');
    expect(slugify('**Owner** setup: _step_ one')).toBe('owner-setup-step-one');
    expect(slugify('snake_case stays')).toBe('snake_case-stays');
    expect([...anchorsOf('# A\n## A ##\n<span id="x"></span>\n')]).toEqual(['a', 'a-1', 'x']);
  });

  it('keeps code-span content in heading anchors, as GitHub does', () => {
    expect([...anchorsOf('## Blocked (`gates-failed`)\n### `npm run verify` ##\n')]).toEqual([
      'blocked-gates-failed',
      'npm-run-verify',
    ]);
    expect([...anchorsOf('Text with `<a id="in-code">` only\n')]).toEqual([]);
  });
});
