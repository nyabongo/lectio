import { DEFAULT_CONFIG } from '@lectio/config';
import { describe, expect, it } from 'vitest';

import { RESEARCH_RESPONSE_SCHEMA } from '../agent/schema.ts';
import {
  DEFAULT_REPAIR_MAX_TOKENS,
  DEFAULT_REPAIR_TOOLS,
  buildRepairRequest,
  fenceFor,
  repairSystemPrompt,
  repairUserMessage,
} from './prompt.ts';

const input = {
  key: 'MT.20.1-16',
  ref: 'Mt 20:1-16a',
  output: { summary: 'x' },
  problems: ['first problem\n  Rule: r\n  Fix: f', 'second problem'],
  attempt: 2,
};

describe('repair prompt', () => {
  it('states the rules with the configured excerpt limit', () => {
    const system = repairSystemPrompt(DEFAULT_CONFIG);
    expect(system).toContain('A verbatim excerpt is at most 12 words');
    expect(system).toContain('At most 5 translation notes');
    expect(system).toContain('Never copy the wording of an English Bible translation');
  });

  it('lists every problem and the whole draft', () => {
    expect(repairUserMessage(input)).toBe(
      [
        'Passage MT.20.1-16 (Mt 20:1-16a), repair 2.',
        '',
        'Problems:',
        '- first problem',
        '    Rule: r',
        '    Fix: f',
        '- second problem',
        '',
        'Current draft:',
        '```json',
        '{\n  "summary": "x"\n}',
        '```',
      ].join('\n'),
    );
    expect(repairUserMessage({ ...input, output: '{"raw' })).toContain('```json\n{"raw\n```');
  });

  it('fences the draft with more backticks than it contains', () => {
    expect(fenceFor('no ticks')).toBe('```');
    expect(fenceFor('a `b` c')).toBe('```');
    expect(fenceFor('```json\n{}\n```')).toBe('````');
    expect(fenceFor('x ````` y')).toBe('``````');
    const message = repairUserMessage({ ...input, output: 'text\n```\nmore' });
    expect(message).toContain('Current draft:\n````json\ntext\n```\nmore\n````');
  });

  it('builds a repair-role request with the research response schema', () => {
    const request = buildRepairRequest(input, { config: DEFAULT_CONFIG });
    expect(request).toMatchObject({
      role: 'repair',
      model: DEFAULT_CONFIG.research.models.repair.model,
      responseSchema: RESEARCH_RESPONSE_SCHEMA,
      tools: DEFAULT_REPAIR_TOOLS,
      maxTokens: DEFAULT_REPAIR_MAX_TOKENS,
    });
    expect(request.messages).toEqual([{ role: 'user', content: repairUserMessage(input) }]);
    expect(buildRepairRequest(input, { config: DEFAULT_CONFIG, tools: [], maxTokens: 9 })).toMatchObject({
      tools: [],
      maxTokens: 9,
    });
  });
});
