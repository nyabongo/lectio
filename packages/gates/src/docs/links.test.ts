// Every relative link in the gates docs resolves: the file exists and, for a markdown target, the
// `#anchor` names one of its headings (GitHub's slugs).
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
const DOCS = ['docs/gates.md', 'docs/reviewer-guide.md'];

/** Markdown without fenced code blocks or inline code spans. */
function prose(text: string): string {
  return text.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1\s*$/gm, '').replace(/`[^`\n]*`/g, '');
}

/** GitHub's heading anchor: lower case, punctuation dropped, spaces to hyphens. */
function slug(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

function anchors(markdown: string): Set<string> {
  const text = markdown.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1\s*$/gm, '');
  return new Set([...text.matchAll(/^#{1,6} (.+)$/gm)].map(([, heading]) => slug(heading ?? '')));
}

function links(markdown: string): string[] {
  return [...prose(markdown).matchAll(/\]\(([^)\s]+)\)/g)].map(([, target]) => target ?? '');
}

describe('gates docs links', () => {
  it('slugs headings like GitHub', () => {
    expect(slug('The `llm-verifiers` environment')).toBe('the-llm-verifiers-environment');
    expect(slug('1. Schema tests (`schema`)')).toBe('1-schema-tests-schema');
  });

  for (const doc of DOCS) {
    it(`${doc}: every relative link resolves`, () => {
      const path = resolve(REPO, doc);
      const found = links(readFileSync(path, 'utf8')).filter((target) => !/^[a-z]+:/.test(target));
      expect(found.length).toBeGreaterThan(0);
      for (const target of found) {
        const [file = '', anchor] = target.split('#');
        const resolved = file === '' ? path : resolve(dirname(path), file);
        expect(existsSync(resolved), `${doc}: ${target}`).toBe(true);
        if (anchor !== undefined && resolved.endsWith('.md')) {
          expect([...anchors(readFileSync(resolved, 'utf8'))], `${doc}: ${target}`).toContain(anchor);
        }
      }
    });
  }
});
