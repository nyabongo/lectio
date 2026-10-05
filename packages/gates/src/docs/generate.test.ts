import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG } from '@lectio/config';

import type { Gate } from '../core/gate.ts';
import { defineRule, RUNNER_RULES } from '../core/rules.ts';
import { LIMITATION } from '../licence-gate/index.ts';
import { DECISIONS } from '../merge-rule/index.ts';
import { GATES } from '../registry.ts';
import {
  DECISION_TEXT,
  GATE_SUMMARIES,
  GATES_DOC_PATH,
  TEMPLATE_URL,
  fillTemplate,
  generatedBlocks,
  renderGatesDoc,
} from './generate.ts';
import { SAMPLE_HEAD } from './sample.ts';

const DOC = fileURLToPath(new URL(`../../../../${GATES_DOC_PATH}`, import.meta.url));

describe('docs/gates.md', () => {
  it('is in sync with the rule registry (run `npm run gates:docs` when this fails)', async () => {
    expect(readFileSync(DOC, 'utf8')).toBe(await renderGatesDoc());
  });

  it('lists every gate, every rule and its fix, and the runner rules', async () => {
    const doc = await renderGatesDoc();
    for (const gate of GATES) {
      expect(doc).toContain(`(\`${gate.id}\`)`);
      for (const rule of gate.rules) {
        expect(doc).toContain(`**\`${rule.id}\`**`);
        expect(doc).toContain(rule.fix.split(' ').slice(0, 4).join(' '));
      }
    }
    for (const rule of Object.values(RUNNER_RULES)) expect(doc).toContain(`**\`${rule.id}\`**`);
  });

  it('quotes the licence-guard limitation, every decision and the sample comment', async () => {
    const doc = await renderGatesDoc();
    expect(doc).toContain(`> ${LIMITATION.split(' ').slice(0, 6).join(' ')}`);
    for (const decision of DECISIONS) expect(doc).toContain(`| \`${decision}\``);
    expect(doc).toContain('Merge rule: `needs-review` (waiting for human review)');
    expect(doc).toContain(`Checked head: \`${SAMPLE_HEAD}\``);
    expect(doc).toContain('llm-verifiers');
    expect(doc).toContain('`packages/gates/**`, `.github/**`, `config/**`');
  });

  it('drops the template header and leaves no placeholder behind', async () => {
    const doc = await renderGatesDoc();
    expect(doc.startsWith('# Content gates\n')).toBe(true);
    expect(doc).not.toMatch(/<!-- (generated|template):/);
  });

  it('describes every gate and every decision', () => {
    expect(Object.keys(GATE_SUMMARIES)).toEqual(GATES.map((gate) => gate.id));
    expect(Object.keys(DECISION_TEXT).sort()).toEqual([...DECISIONS].sort());
  });
});

describe('generatedBlocks', () => {
  it('refuses a gate without a summary', () => {
    const gate: Gate = {
      id: 'mystery',
      title: 'Mystery',
      rules: [defineRule('mystery/rule', 'Holds.', 'Fix it.')],
      run: () => ({ gate: 'mystery', status: 'pass', items: [], meta: {} }),
    };
    expect(() => generatedBlocks([gate])).toThrow('no summary for gate "mystery"');
  });

  it('reads the config it is given', () => {
    const config = { ...DEFAULT_CONFIG, autoMerge: { ...DEFAULT_CONFIG.autoMerge, minSupport: 0.85 } };
    const blocks = generatedBlocks(GATES, config);
    expect(blocks['config']).toContain('| `autoMerge.minSupport` | `0.85` |');
    expect(blocks['sample-comment']).toContain('refuter support 0.78 is below 0.85');
  });
});

describe('fillTemplate', () => {
  it('replaces placeholders inline and on their own line', () => {
    const template = '<!-- template: note\n-->\n\n# T\n\nA <!-- generated:a --> B\n\n<!-- generated:b -->\n';
    expect(fillTemplate(template, { a: 'x', b: 'y' })).toBe('# T\n\nA x B\n\ny\n');
  });

  it('refuses an unknown placeholder and an unused block', () => {
    expect(() => fillTemplate('<!-- generated:nope -->', {})).toThrow('unknown placeholder "nope"');
    expect(() => fillTemplate('<!-- generated:a -->', { a: 'x', b: 'y', c: 'z' })).toThrow('never uses b, c');
  });

  it('formats with Prettier for the path it is given', async () => {
    const text = await renderGatesDoc({ template: readFileSync(TEMPLATE_URL, 'utf8'), filepath: DOC });
    expect(text).toBe(readFileSync(DOC, 'utf8'));
  });
});
