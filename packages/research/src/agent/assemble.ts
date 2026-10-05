/**
 * Turns the model's research output into a complete passage file: it adds the identity fields
 * (key, ref, locale, schema version), stable translation-note ids, the run's provenance and a
 * pending review block, fills `retrievedAt` on web sources the model left without one, and
 * validates the result against the passage schema.
 */
import { PASSAGES_DIR, checkPassage } from '@lectio/content';
import type { LlmFamily } from '@lectio/providers';
import { PASSAGE_SCHEMA_VERSION } from '@lectio/schema/passage';
import type { Passage } from '@lectio/schema/passage';

import type { ResearchOutput } from './schema.ts';

export interface AssembleMeta {
  readonly key: string;
  /** Lectionary reference with sub-verse letters (`Mt 20:1-16a`). */
  readonly ref: string;
  readonly locale: string;
  readonly runId: string;
  /** Models that wrote the output, as billed. */
  readonly models: readonly string[];
  /** The family that answered; `fake` output is marked `generator: 'fake'` so gates reject it. */
  readonly family: LlmFamily;
  readonly promptVersion: string;
  /** RFC 3339 instant of the run; also the `retrievedAt` of web sources the model left without one. */
  readonly createdAt: string;
  readonly costUsd: number;
}

const SLUG_MAX = 64;

/** A kebab-case slug of `text`, ASCII only (diacritics dropped); `fallback` when nothing is left. */
export function slugify(text: string, fallback: string): string {
  const slug = text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, SLUG_MAX)
    .replace(/^-+|-+$/g, '');
  return slug === '' ? fallback : slug;
}

/** Makes `base` unique among `taken` by appending `-2`, `-3`, … (within the slug length limit). */
function unique(base: string, taken: Set<string>): string {
  let id = base;
  for (let n = 2; taken.has(id); n++) {
    const suffix = `-${String(n)}`;
    id = `${base.slice(0, SLUG_MAX - suffix.length).replace(/-+$/, '')}${suffix}`;
  }
  taken.add(id);
  return id;
}

/** Builds and validates the passage; throws a `ContentError` listing every schema problem. */
export function assemblePassage(output: ResearchOutput, meta: AssembleMeta): Passage {
  const ids = new Set<string>();
  const translationNotes = output.translationNotes.map((note) => ({
    id: unique(slugify(note.original.translit, 'note'), ids),
    ...note,
  }));
  const sources = output.sources.map((source) =>
    source.type === 'web' && source.retrievedAt === undefined ? { ...source, retrievedAt: meta.createdAt } : source,
  );
  const passage = {
    key: meta.key,
    ref: meta.ref,
    locale: meta.locale,
    summary: output.summary,
    context: output.context,
    translationNotes,
    claims: output.claims,
    sources,
    provenance: {
      generator: meta.family === 'fake' ? 'fake' : 'research-cli',
      runId: meta.runId,
      models: [...new Set(meta.models)],
      promptVersion: meta.promptVersion,
      createdAt: meta.createdAt,
      costUsd: meta.costUsd,
    },
    review: { status: 'pending', reviewers: [] },
    schemaVersion: PASSAGE_SCHEMA_VERSION,
  };
  return checkPassage(passage, passagePath(meta.key), meta.key);
}

/** Repository-relative path of a passage file. */
export function passagePath(key: string): string {
  return `${PASSAGES_DIR}/${key}.json`;
}
