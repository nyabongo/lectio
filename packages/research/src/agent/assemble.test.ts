import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { ContentError } from '@lectio/content';
import { validatePassage } from '@lectio/schema/passage';
import type { Passage } from '@lectio/schema/passage';
import { describe, expect, it } from 'vitest';

import { assemblePassage, passagePath, slugify } from './assemble.ts';
import type { AssembleMeta } from './assemble.ts';
import { MT_20_OUTPUT } from './fixtures/fake-research.ts';
import type { ResearchOutput } from './schema.ts';

const SEED = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../../passages/MT.20.1-16.json', import.meta.url)), 'utf8'),
) as Passage;

const meta: AssembleMeta = {
  key: 'MT.20.1-16',
  ref: 'Mt 20:1-16a',
  locale: 'en',
  runId: 'research-20261005T075000Z',
  models: ['claude-opus-5-5', 'claude-opus-5-5'],
  family: 'anthropic',
  promptVersion: 'research-v1@0123456789ab',
  createdAt: '2026-10-05T07:50:00.000Z',
  costUsd: 0.5,
};

describe('assemblePassage', () => {
  it('builds a schema-valid pending passage with the run provenance', () => {
    const passage = assemblePassage(MT_20_OUTPUT, meta);
    expect(validatePassage(passage)).toBe(true);
    expect(passage).toMatchObject({
      key: 'MT.20.1-16',
      ref: 'Mt 20:1-16a',
      locale: 'en',
      summary: SEED.summary,
      provenance: {
        generator: 'research-cli',
        runId: meta.runId,
        models: ['claude-opus-5-5'],
        promptVersion: meta.promptVersion,
        createdAt: meta.createdAt,
        costUsd: 0.5,
      },
      review: { status: 'pending', reviewers: [] },
      schemaVersion: 1,
    });
  });

  it('keeps the model’s content and adds translation-note ids from the transliteration', () => {
    const passage = assemblePassage(MT_20_OUTPUT, meta);
    expect(passage.translationNotes.map((n) => n.id)).toEqual([
      'ophthalmos-sou-poneros',
      'agathos',
      'denariou',
      'hetaire',
    ]);
    expect(passage.context).toEqual(SEED.context);
    expect(passage.claims).toEqual(SEED.claims);
  });

  it('dates web sources the model left undated with the run time', () => {
    const passage = assemblePassage(MT_20_OUTPUT, meta);
    const byId = new Map(passage.sources.map((s) => [s.id, s]));
    expect(byId.get('jfb-mt-20-1')?.retrievedAt).toBe(meta.createdAt);
    expect(byId.get('meyer-mt-20-2')?.retrievedAt).toBe('2026-10-05T07:42:00Z');
    expect(byId.get('mt-19-27')).not.toHaveProperty('retrievedAt');
  });

  it('marks fake output so the gates reject it as provenance', () => {
    expect(assemblePassage(MT_20_OUTPUT, { ...meta, family: 'fake' }).provenance.generator).toBe('fake');
  });

  it('makes duplicate note ids unique', () => {
    const [note] = MT_20_OUTPUT.translationNotes;
    const output: ResearchOutput = { ...MT_20_OUTPUT, translationNotes: [note!, note!, note!] };
    expect(assemblePassage(output, meta).translationNotes.map((n) => n.id)).toEqual([
      'ophthalmos-sou-poneros',
      'ophthalmos-sou-poneros-2',
      'ophthalmos-sou-poneros-3',
    ]);
  });

  it('throws a ContentError naming every problem', () => {
    const error = (() => {
      try {
        assemblePassage(MT_20_OUTPUT, { ...meta, locale: 'English', runId: '' });
      } catch (e) {
        return e;
      }
      return undefined;
    })() as ContentError;
    expect(error).toBeInstanceOf(ContentError);
    expect(error.file).toBe('passages/MT.20.1-16.json');
    expect(error.issues.map((i) => i.pointer)).toEqual(expect.arrayContaining(['/locale', '/provenance/runId']));
  });
});

describe('slugify', () => {
  it('folds diacritics and punctuation into a kebab-case slug', () => {
    expect(slugify('ophthalmos sou ponēros', 'x')).toBe('ophthalmos-sou-poneros');
    expect(slugify('  Ḥesed — “love”  ', 'x')).toBe('hesed-love');
  });

  it('falls back when nothing is left', () => {
    expect(slugify('ἀγαθός', 'note')).toBe('note');
  });

  it('keeps ids within 64 characters, suffixes included', () => {
    const long = 'a'.repeat(70);
    expect(slugify(long, 'x')).toHaveLength(64);
    const [note] = MT_20_OUTPUT.translationNotes;
    const longNote = { ...note!, original: { ...note!.original, translit: long } };
    const passage = assemblePassage({ ...MT_20_OUTPUT, translationNotes: [longNote, longNote] }, meta);
    expect(passage.translationNotes.map((n) => n.id.length)).toEqual([64, 64]);
    expect(passage.translationNotes[1]?.id.endsWith('-2')).toBe(true);
  });
});

describe('passagePath', () => {
  it('is passages/<key>.json', () => {
    expect(passagePath('MT.20.1-16')).toBe('passages/MT.20.1-16.json');
  });
});
