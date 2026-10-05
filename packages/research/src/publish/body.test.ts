import { DEFAULT_CONFIG } from '@lectio/config';
import { describe, expect, it } from 'vitest';

import {
  GATES_END,
  GATES_START,
  RESEARCH_TRAILER,
  bodyMarker,
  code,
  commitMessage,
  hashInBody,
  inline,
  keepGates,
  prBody,
  prTitle,
} from './body.ts';
import type { PrTextInput } from './body.ts';
import { researchPassage } from './fixtures/passage.ts';

const HASH = 'a'.repeat(64);

function input(overrides: Partial<PrTextInput> = {}): PrTextInput {
  return {
    passage: researchPassage(),
    path: 'passages/MT.20.1-16.json',
    dates: ['2026-09-20'],
    contentHash: HASH,
    reviewer: DEFAULT_CONFIG.reviewer,
    ...overrides,
  };
}

describe('prTitle', () => {
  it('names the reference and the key', () => {
    expect(prTitle({ key: 'MT.20.1-16', ref: ' Mt  20:1-16a ' })).toBe('Research: Mt 20:1-16a (MT.20.1-16)');
  });
});

describe('commitMessage', () => {
  it('ends with the attribution trailer', () => {
    const message = commitMessage(researchPassage());
    expect(message.split('\n')).toEqual([
      'Research MT.20.1-16 (Mt 20:1-16a)',
      '',
      'A landowner pays the last hired the same as the first, and asks whether his goodness is resented.',
      '',
      `${RESEARCH_TRAILER}: key=MT.20.1-16 run=2026-09-01-mt-20-1-16-a1b2c3 prompt=research-v1 models=claude-opus-5-5`,
    ]);
  });

  it('keeps the trailer on one line and says when no model was used', () => {
    const passage = researchPassage({
      summary: 'two\nlines',
      provenance: {
        generator: 'fake',
        runId: 'run 1',
        models: [],
        promptVersion: 'v 2',
        createdAt: '2026-09-01T00:00:00Z',
      },
    });
    const lines = commitMessage(passage).split('\n');
    expect(lines[2]).toBe('two lines');
    expect(lines.at(-1)).toBe(`${RESEARCH_TRAILER}: key=MT.20.1-16 run=run_1 prompt=v_2 models=none`);
  });
});

describe('inline', () => {
  it('escapes HTML and Markdown and keeps mentions and issue links inert', () => {
    expect(inline(' a <!-- b --> *c* [d](e) `f` @g #1 &\n x ')).toBe(
      'a &lt;!-- b --&gt; \\*c\\* \\[d\\](e) \\`f\\` @​g #​1 &amp; x',
    );
  });
});

describe('body marker', () => {
  it('round-trips the hash for the right key only', () => {
    const body = `text\n\n${bodyMarker('MT.20.1-16', HASH)}\n`;
    expect(hashInBody(body, 'MT.20.1-16')).toBe(HASH);
    expect(hashInBody(body, 'IS.55.6-9')).toBeNull();
    expect(hashInBody('<!-- lectio-research key=MT.20.1-16 sha256=xyz -->', 'MT.20.1-16')).toBeNull();
  });

  it('reads the last marker when a body was edited to contain two', () => {
    const body = `${bodyMarker('MT.20.1-16', 'b'.repeat(64))}\n${bodyMarker('MT.20.1-16', HASH)}`;
    expect(hashInBody(body, 'MT.20.1-16')).toBe(HASH);
  });
});

describe('prBody', () => {
  it('describes the passage, the gates placeholder and how to approve', () => {
    const body = prBody(input());
    expect(body).toContain('## Mt 20:1-16a: Labourers in the vineyard');
    expect(body).toContain('> A landowner pays the last hired the same as the first');
    expect(body).toContain('| Reference | Mt 20:1-16a |');
    expect(body).toContain('| Passage key | `MT.20.1-16` |');
    expect(body).toContain('| Dates | 2026-09-20 |');
    expect(body).toContain('| Claims | 2 (1 sensitive) |');
    expect(body).toContain('| Sources | 3 (1 scripture, 1 web, 1 print) |');
    expect(body).toContain('| Translation notes | 1 |');
    expect(body).toContain('| Cost | $0.84 |');
    expect(body).toContain('| Models | `claude-opus-5-5` |');
    expect(body).toContain('| Prompt version | `research-v1` |');
    expect(body).toContain('| Run | `2026-09-01-mt-20-1-16-a1b2c3` |');
    expect(body).toContain('| File | `passages/MT.20.1-16.json` |');
    const gates = body.slice(body.indexOf(GATES_START), body.indexOf(GATES_END));
    expect(gates.match(/- \[ \]/gu)).toHaveLength(5);
    expect(gates).toContain('Placeholder');
    expect(body).toContain('- [ ] Every claim (2 claims) is supported by the sources it cites');
    expect(body).toContain('- [ ] Sensitive claims (1) are stated fairly and carefully');
    expect(body).toContain('(`nyabongo`) adds the `approved` label or comments `/approve`');
    expect(body).toContain('a new commit (for example a research fix-up) resets it');
    expect(body).toContain('never closes this PR');
    expect(body.trimEnd().endsWith(bodyMarker('MT.20.1-16', HASH))).toBe(true);
  });

  it('prefers the run cost and handles empty lists', () => {
    const passage = researchPassage({
      claims: [{ id: 'c1', text: 'One claim.', sourceIds: ['s'], sensitive: false }],
      sources: [],
      provenance: { generator: 'fake', runId: 'r', models: [], promptVersion: 'p', createdAt: '2026-09-01T00:00:00Z' },
    });
    const body = prBody(
      input({
        passage,
        dates: [],
        costUsd: 1.234,
        reviewer: { githubHandles: [], approvalLabel: 'ok', approvalCommand: '/ok' },
      }),
    );
    expect(body).toContain('| Dates | none in this run |');
    expect(body).toContain('| Sources | 0 |');
    expect(body).toContain('| Cost | $1.23 |');
    expect(body).toContain('| Models | none |');
    expect(body).toContain('Every claim (1 claim)');
    expect(body).toContain('(none configured yet) adds the `ok` label or comments `/ok`');
  });

  it('says when the cost was not recorded', () => {
    const { costUsd: _cost, ...provenance } = researchPassage().provenance;
    expect(prBody(input({ passage: researchPassage({ provenance }) }))).toContain('| Cost | not recorded |');
  });
});

describe('table cells', () => {
  it('escapes pipes in code spans inside the table only', () => {
    expect(code('a|b`c')).toBe('`a|bc`');
    expect(code('a|b', true)).toBe('`a\\|b`');
    const passage = researchPassage({
      provenance: {
        generator: 'research-cli',
        runId: 'run|1',
        models: ['model|x'],
        promptVersion: 'v|1',
        createdAt: '2026-09-01T00:00:00Z',
      },
    });
    const body = prBody(input({ passage, dates: ['2026|09'] }));
    expect(body).toContain('| Run | `run\\|1` |');
    expect(body).toContain('| Models | `model\\|x` |');
    expect(body).toContain('| Prompt version | `v\\|1` |');
    expect(body).toContain('| Dates | 2026\\|09 |');
  });
});

describe('keepGates', () => {
  const body = (gates: string): string => `top\n${GATES_START}\n${gates}\n${GATES_END}\nbottom`;

  it('carries the previous gate section into the new body', () => {
    expect(keepGates(body('new'), body('- [x] reported'))).toBe(body('- [x] reported'));
  });

  it('keeps the new body when either side lacks a complete section', () => {
    expect(keepGates(body('new'), 'edited by hand')).toBe(body('new'));
    expect(keepGates(body('new'), `${GATES_START} without an end`)).toBe(body('new'));
    expect(keepGates('no section', body('old'))).toBe('no section');
  });
});
