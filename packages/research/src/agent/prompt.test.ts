import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { sha256Hex } from '@lectio/providers';
import { describe, expect, it } from 'vitest';

import {
  PROMPTS_DIR,
  PromptError,
  RESEARCH_PROMPT,
  loadPromptTemplate,
  parsePromptTemplate,
  promptVersion,
  renderTemplate,
} from './prompt.ts';

describe('promptVersion', () => {
  it('is the name and the first 12 hex digits of the sha256', () => {
    expect(promptVersion('research-v1', 'abc')).toBe(`research-v1@${sha256Hex('abc').slice(0, 12)}`);
  });
});

describe('parsePromptTemplate', () => {
  it('splits the System and User sections and ignores the preamble', () => {
    const template = parsePromptTemplate(
      't',
      '# t\n\npreamble\n\n## System\n\nBe careful.\n\n### Rules\n\nx\n\n## User\n\nHi {{who}}.\n',
    );
    expect(template.system).toBe('Be careful.\n\n### Rules\n\nx');
    expect(template.user).toBe('Hi {{who}}.');
    expect(template.version).toMatch(/^t@[0-9a-f]{12}$/);
  });

  it.each([
    ['no sections', 'just text'],
    ['user before system', '## User\n\nu\n\n## System\n\ns\n'],
    ['only system', '## System\n\ns\n'],
  ])('rejects a file with %s', (_label, content) => {
    expect(() => parsePromptTemplate('t', content)).toThrow(/needs a "## System" section/);
  });

  it('rejects empty sections', () => {
    expect(() => parsePromptTemplate('t', '## System\n\n## User\n\nu')).toThrow(/must not be empty/);
    expect(() => parsePromptTemplate('t', '## System\n\ns\n\n## User\n')).toThrow(PromptError);
  });

  it('rejects a bad name', () => {
    expect(() => parsePromptTemplate('../x', '## System\ns\n## User\nu')).toThrow(/invalid prompt name/);
  });
});

describe('loadPromptTemplate', () => {
  it('loads research-v1 by default, versioned by its content hash', async () => {
    const content = await readFile(join(PROMPTS_DIR, `${RESEARCH_PROMPT}.md`), 'utf8');
    const template = await loadPromptTemplate();
    expect(template.name).toBe('research-v1');
    expect(template.version).toBe(promptVersion('research-v1', content));
  });

  it('reads from an injected directory and reader', async () => {
    const paths: string[] = [];
    const template = await loadPromptTemplate('custom-v2', {
      dir: '/prompts',
      readFile: async (path) => {
        paths.push(path);
        return '## System\nS\n## User\nU';
      },
    });
    expect(paths).toEqual(['/prompts/custom-v2.md']);
    expect(template).toMatchObject({ name: 'custom-v2', system: 'S', user: 'U' });
  });

  it('rejects a name that could escape the prompts directory', async () => {
    await expect(loadPromptTemplate('../secrets')).rejects.toThrow(PromptError);
  });
});

describe('renderTemplate', () => {
  it('fills every placeholder, numbers included', () => {
    expect(renderTemplate('{{a}} and {{b}} and {{a}}', { a: 'x', b: 12 })).toBe('x and 12 and x');
  });

  it('names every missing placeholder, inherited object keys included', () => {
    expect(() => renderTemplate('{{a}} {{toString}} {{c}}', { a: 'x' })).toThrow(
      'no value for placeholder(s): toString, c',
    );
  });
});

describe('research-v1', () => {
  it('states the hard rules the gates rely on', async () => {
    const { system, user } = await loadPromptTemplate();
    expect(system).toMatch(/Never reproduce Bible translation text/);
    expect(system).toMatch(/Every sentence cites a source/);
    expect(system).toMatch(/\{\{maxExcerptWords\}\} words or fewer/);
    expect(system).toMatch(/Check original-language words against the corpus/);
    expect(system).toMatch(/Flag doctrinally sensitive claims/);
    for (const name of ['key', 'ref', 'slot', 'locale', 'calendar', 'originalText']) {
      expect(user).toContain(`{{${name}}}`);
    }
  });
});
