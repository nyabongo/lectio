import type { GateResultItem } from '@lectio/gates';
import type { Passage } from '@lectio/schema/passage';
import { describe, expect, it } from 'vitest';

import { applyDrops, planDrops, stripClaims } from './drop.ts';

const note = (id: string, body: string) => ({
  id,
  verse: '20:2',
  anchor: id,
  original: { text: 'δηναρίου', lang: 'grc', translit: id, gloss: 'g' },
  summary: 's',
  body,
});

const claim = (id: string, sourceIds: string[]) => ({ id, text: `claim ${id}`, sourceIds, sensitive: false });
const source = (id: string) => ({ id, type: 'print', citation: id });

const PASSAGE = {
  key: 'MT.20.1-16',
  ref: 'Mt 20:1-16a',
  locale: 'en',
  summary: 'summary',
  context: {
    title: 'title',
    paragraphs: ['One. [c1] Two. [c2][c3] Three. [c3]', 'Four. [c4]'],
  },
  translationNotes: [note('first', 'Note one. [c1]'), note('second', 'Note two. [c5]')],
  claims: [
    claim('c1', ['s1']),
    claim('c2', ['s2']),
    claim('c3', ['s3', 's2']),
    claim('c4', ['s4']),
    claim('c5', ['s5']),
  ],
  sources: [source('s1'), source('s2'), source('s3'), source('s4'), source('s5'), source('s6')],
} as unknown as Passage;

const item = (fields: Partial<GateResultItem>): GateResultItem => ({
  ruleId: 'evidence/x',
  severity: 'error',
  pointer: '',
  message: 'bad',
  ...fields,
});

describe('planDrops', () => {
  it('traces each finding to a note, a claim or an uncited source', () => {
    const plan = planDrops(PASSAGE, [
      item({ pointer: '/translationNotes/1/original/text', claimId: 'c5', message: 'note' }),
      item({ pointer: '/sources/0/excerpt', claimId: 'c2', message: 'by claim id' }),
      item({ pointer: '/claims/3/text', claimId: 'c99', message: 'by claim pointer' }),
      item({ pointer: '/sources/2', message: 'source cited by c3' }),
      item({ pointer: '/sources/5', message: 'uncited source' }),
      item({ pointer: '/sources/1', claimId: 'c2', message: 'again' }),
    ]);
    expect(plan).toEqual({
      ok: true,
      targets: [
        { kind: 'note', id: 'second', reason: 'evidence/x: note' },
        { kind: 'claim', id: 'c2', reason: 'evidence/x: by claim id' },
        { kind: 'claim', id: 'c4', reason: 'evidence/x: by claim pointer' },
        { kind: 'claim', id: 'c3', reason: 'evidence/x: source cited by c3' },
        { kind: 'source', id: 's6', reason: 'evidence/x: uncited source' },
      ],
    });
  });

  it('names the findings no drop can fix', () => {
    const summary = item({ pointer: '/summary' });
    const whole = item({ file: undefined, pointer: '' });
    const outOfRange = item({ pointer: '/translationNotes/9/body' });
    expect(planDrops(PASSAGE, [item({ claimId: 'c1' }), summary, whole, outOfRange])).toEqual({
      ok: false,
      unattributable: [summary, whole, outOfRange],
    });
  });
});

describe('stripClaims', () => {
  it('removes markers and the sentences left uncited', () => {
    const text = 'One. [c1] Two. [c2][c3] Three. [c3]';
    expect(stripClaims(text, new Set(['c3']))).toBe('One. [c1] Two. [c2]');
    expect(stripClaims(text, new Set(['c1']))).toBe('Two. [c2][c3] Three. [c3]');
    expect(stripClaims(text, new Set(['c1', 'c2', 'c3']))).toBe('');
    expect(stripClaims(text, new Set())).toBe(text);
  });

  it('leaves text that is not marker-shaped alone', () => {
    expect(stripClaims('No marker here.', new Set(['c1']))).toBe('No marker here.');
    expect(stripClaims('One. [c1] trailing', new Set(['c1']))).toBe('One. [c1] trailing');
  });
});

describe('applyDrops', () => {
  it('removes a claim with its sentences and whatever it leaves uncited', () => {
    const { passage, dropped } = applyDrops(PASSAGE, [{ kind: 'claim', id: 'c4', reason: 'r' }]);
    expect(passage.context.paragraphs).toEqual(['One. [c1] Two. [c2][c3] Three. [c3]']);
    expect(passage.claims.map((c) => c.id)).toEqual(['c1', 'c2', 'c3', 'c5']);
    expect(passage.sources.map((s) => s.id)).toEqual(['s1', 's2', 's3', 's5', 's6']);
    expect(dropped).toEqual([
      { kind: 'claim', id: 'c4', reason: 'r' },
      { kind: 'source', id: 's4', reason: 'only dropped claims cited it' },
    ]);
    expect(passage.translationNotes).toBe(passage.translationNotes);
    expect(passage.translationNotes[0]).toBe(PASSAGE.translationNotes[0]);
  });

  it('removes a note whole, with the claims only it cited', () => {
    const { passage, dropped } = applyDrops(PASSAGE, [
      { kind: 'note', id: 'second', reason: 'r' },
      { kind: 'source', id: 's6', reason: 'uncited' },
    ]);
    expect(passage.translationNotes.map((n) => n.id)).toEqual(['first']);
    expect(dropped).toEqual([
      { kind: 'note', id: 'second', reason: 'r' },
      { kind: 'claim', id: 'c5', reason: 'only a dropped note or sentence cited it' },
      { kind: 'source', id: 's5', reason: 'only dropped claims cited it' },
      { kind: 'source', id: 's6', reason: 'uncited' },
    ]);
  });

  it('removes a note whose body cited only dropped claims, and keeps the rest of a shortened body', () => {
    const shared = {
      ...PASSAGE,
      translationNotes: [note('first', 'Note one. [c1] More. [c2]'), note('second', 'Note two. [c5]')],
    } as unknown as Passage;
    const { passage, dropped } = applyDrops(shared, [
      { kind: 'claim', id: 'c5', reason: 'r5' },
      { kind: 'claim', id: 'c2', reason: 'r2' },
    ]);
    expect(passage.translationNotes.map((n) => [n.id, n.body])).toEqual([['first', 'Note one. [c1]']]);
    expect(passage.context.paragraphs).toEqual(['One. [c1] Two. [c3] Three. [c3]', 'Four. [c4]']);
    expect(dropped.map((d) => `${d.kind} ${d.id}: ${d.reason}`)).toEqual([
      'note second: every sentence of its body cited a dropped claim',
      'claim c2: r2',
      'claim c5: r5',
      'source s5: only dropped claims cited it',
    ]);
  });
});
