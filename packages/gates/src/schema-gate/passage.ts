/**
 * The checks of gate 1 on one passage file that already matches the passage schema: its key,
 * references and note verses; claims, sources and markers; unique ids; the review block; and
 * provenance.
 */
import type { LectioConfig } from '@lectio/config';
import { enumerateVerses, fromKey, isRealVerse, parseRef, toKey, verseCounts } from '@lectio/refs';
import type { Ref } from '@lectio/refs';
import type { Passage } from '@lectio/schema/passage';

import { finding } from '../core/result.ts';
import type { GateResultItem } from '../core/result.ts';
import { SCHEMA_RULES } from './rules.ts';
import { MARKER_FORMAT, citedSentences, excerpt, markerIds } from './sentences.ts';

type Push = (item: GateResultItem) => void;

/** The passage key a file name promises: `passages/MT.20.1-16.json` → `MT.20.1-16`. */
export function keyOfPath(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1, -'.json'.length);
}

/** Pointers to `[index, id]` pairs whose id appeared before. */
function duplicates(ids: readonly string[]): [number, string][] {
  const seen = new Set<string>();
  const repeated: [number, string][] = [];
  ids.forEach((id, index) => {
    if (seen.has(id)) repeated.push([index, id]);
    seen.add(id);
  });
  return repeated;
}

/** Reports a duplicate id in `ids` (the array at `pointer`) under schema/unique-ids. */
export function checkUnique(
  push: Push,
  file: string,
  pointer: string,
  ids: readonly string[],
  what: string,
  suffix = '/id',
): void {
  for (const [index, id] of duplicates(ids)) {
    push(
      finding(SCHEMA_RULES.uniqueIds, {
        file,
        pointer: `${pointer}/${String(index)}${suffix}`,
        message: `${what} ${JSON.stringify(id)} appears more than once`,
      }),
    );
  }
}

function refMessage(error: unknown): string {
  return (error as Error).message;
}

/** Key and `ref`: canonical, parseable, real, and in agreement. Returns the parsed key or `null`. */
function checkKeyAndRef(push: Push, file: string, passage: Passage): Ref | null {
  const expected = keyOfPath(file);
  if (passage.key !== expected) {
    push(
      finding(SCHEMA_RULES.keyMatchesFilename, {
        file,
        pointer: '/key',
        message: `key ${JSON.stringify(passage.key)} does not match the file name, which promises ${JSON.stringify(expected)}`,
      }),
    );
  }
  let key: Ref;
  try {
    key = fromKey(passage.key);
  } catch (error) {
    push(finding(SCHEMA_RULES.refParses, { file, pointer: '/key', message: refMessage(error) }));
    return null;
  }
  if (!isRealVerse(key)) {
    push(
      finding(SCHEMA_RULES.refIsRealVerse, {
        file,
        pointer: '/key',
        message: `key ${passage.key} names a chapter or verse that does not exist`,
      }),
    );
    return null;
  }
  try {
    const fromRef = toKey(parseRef(passage.ref));
    if (fromRef !== passage.key) {
      push(
        finding(SCHEMA_RULES.refParses, {
          file,
          pointer: '/ref',
          message: `ref ${JSON.stringify(passage.ref)} is passage ${fromRef}, not the file's key ${passage.key}`,
        }),
      );
    }
  } catch (error) {
    push(finding(SCHEMA_RULES.refParses, { file, pointer: '/ref', message: refMessage(error) }));
  }
  return key;
}

/** Every scripture source's `ref` parses and names real verses. */
function checkSourceRefs(push: Push, file: string, passage: Passage): void {
  passage.sources.forEach((source, index) => {
    if (source.ref === undefined) return;
    const pointer = `/sources/${String(index)}/ref`;
    let ref: Ref;
    try {
      ref = parseRef(source.ref);
    } catch (error) {
      push(finding(SCHEMA_RULES.refParses, { file, pointer, message: refMessage(error) }));
      return;
    }
    if (!isRealVerse(ref)) {
      push(
        finding(SCHEMA_RULES.refIsRealVerse, {
          file,
          pointer,
          message: `source ${source.id} cites ${JSON.stringify(source.ref)}, which names a chapter or verse that does not exist`,
        }),
      );
    }
  });
}

/** Every translation note's verse lies inside the passage. */
function checkNoteVerses(push: Push, file: string, passage: Passage, key: Ref): void {
  const inside = new Set(enumerateVerses(key, verseCounts()).map(({ c, v }) => `${String(c)}:${String(v)}`));
  passage.translationNotes.forEach((note, index) => {
    if (inside.has(note.verse)) return;
    push(
      finding(SCHEMA_RULES.noteVerseInPassage, {
        file,
        pointer: `/translationNotes/${String(index)}/verse`,
        message: `note ${note.id} is on verse ${note.verse}, which is outside ${passage.key}`,
      }),
    );
  });
}

/** Claims, sources and markers: every link resolves and nothing is orphaned. */
function checkCitations(push: Push, file: string, passage: Passage): void {
  const sourceIds = new Set(passage.sources.map((source) => source.id));
  const claimIds = new Set(passage.claims.map((claim) => claim.id));
  const usedSources = new Set<string>();
  passage.claims.forEach((claim, index) => {
    claim.sourceIds.forEach((sourceId, position) => {
      usedSources.add(sourceId);
      if (sourceIds.has(sourceId)) return;
      push(
        finding(SCHEMA_RULES.claimHasSource, {
          file,
          pointer: `/claims/${String(index)}/sourceIds/${String(position)}`,
          claimId: claim.id,
          message: `claim ${claim.id} cites source ${JSON.stringify(sourceId)}, which is not in sources[]`,
        }),
      );
    });
  });
  passage.sources.forEach((source, index) => {
    if (usedSources.has(source.id)) return;
    push(
      finding(SCHEMA_RULES.sourceIsCited, {
        file,
        pointer: `/sources/${String(index)}`,
        message: `source ${source.id} is not cited by any claim`,
      }),
    );
  });

  const texts: [string, string][] = [
    ...passage.context.paragraphs.map((text, index): [string, string] => [
      `/context/paragraphs/${String(index)}`,
      text,
    ]),
    ...passage.translationNotes.map((note, index): [string, string] => [
      `/translationNotes/${String(index)}/body`,
      note.body,
    ]),
  ];
  const cited = new Set<string>();
  for (const [pointer, text] of texts) {
    for (const id of new Set(markerIds(text))) {
      cited.add(id);
      if (!claimIds.has(id)) {
        push(
          finding(SCHEMA_RULES.sentenceCitesClaim, {
            file,
            pointer,
            claimId: id,
            message: `marker [${id}] names no claim in claims[]`,
          }),
        );
      }
    }
    for (const sentence of citedSentences(text, passage.locale)) {
      if (sentence.claimIds.some((id) => claimIds.has(id))) continue;
      push(
        finding(SCHEMA_RULES.sentenceCitesClaim, {
          file,
          pointer,
          message: `sentence “${excerpt(sentence.text)}” carries no valid claim marker (${MARKER_FORMAT})`,
        }),
      );
    }
  }
  passage.claims.forEach((claim, index) => {
    if (cited.has(claim.id)) return;
    push(
      finding(SCHEMA_RULES.sourceIsCited, {
        file,
        pointer: `/claims/${String(index)}`,
        claimId: claim.id,
        message: `claim ${claim.id} is not cited by any [${claim.id}] marker in the context or the notes`,
      }),
    );
  });
}

/**
 * The review block of an approved passage records a valid approval. The passage schema already
 * requires a human approval to name a reviewer and come via cli, label or comment, and an auto
 * approval to carry a verifier summary; this adds what the schema cannot know: the configured
 * reviewers and the auto-merge thresholds. The reviewer may be the PR author (decision 003).
 */
function checkReview(push: Push, file: string, passage: Passage, config: LectioConfig): void {
  const { review } = passage;
  if (review.status !== 'approved') return;
  const flag = (pointer: string, message: string): void => {
    push(finding(SCHEMA_RULES.approvedHasReviewer, { file, pointer: `/review${pointer}`, message }));
  };
  if (review.method === 'human') {
    const configured = config.reviewer.githubHandles;
    const handles = new Set(configured.map((handle) => handle.toLowerCase()));
    review.reviewers.forEach((reviewer, index) => {
      if (handles.has(reviewer.toLowerCase())) return;
      const known = configured.length === 0 ? 'none' : configured.join(', ');
      flag(
        `/reviewers/${String(index)}`,
        `${JSON.stringify(reviewer)} is not in config.reviewer.githubHandles (${known})`,
      );
    });
    return;
  }
  // The schema guarantees an auto approval carries its verifier summary.
  const summary = review.verifierSummary as NonNullable<typeof review.verifierSummary>;
  const { minSupport, maxRefutations } = config.autoMerge;
  const lowest = Math.min(summary.confirmer.minSupport, summary.refuter.minSupport, summary.minSupport);
  if (lowest < minSupport) {
    flag(
      '/verifierSummary/minSupport',
      `lowest verifier support ${String(lowest)} is below config.autoMerge.minSupport ${String(minSupport)}`,
    );
  }
  if (summary.refutations > maxRefutations) {
    flag(
      '/verifierSummary/refutations',
      `${String(summary.refutations)} refutations exceed config.autoMerge.maxRefutations ${String(maxRefutations)}`,
    );
  }
}

/** Content from the fake generator, or naming the fake model, never lands. */
function checkProvenance(push: Push, file: string, passage: Passage): void {
  const { provenance } = passage;
  if (provenance.generator === 'fake') {
    push(
      finding(SCHEMA_RULES.noFakeProvenance, {
        file,
        pointer: '/provenance/generator',
        message: 'provenance.generator is "fake": this passage came from the fake provider',
      }),
    );
  }
  provenance.models.forEach((model, index) => {
    if (model.toLowerCase() !== 'fake') return;
    push(
      finding(SCHEMA_RULES.noFakeProvenance, {
        file,
        pointer: `/provenance/models/${String(index)}`,
        message: 'provenance.models lists the fake model',
      }),
    );
  });
}

/** Every gate-1 finding for a schema-valid passage at `file`. */
export function checkPassageRules(file: string, passage: Passage, config: LectioConfig): GateResultItem[] {
  const items: GateResultItem[] = [];
  const push: Push = (item) => items.push(item);
  const key = checkKeyAndRef(push, file, passage);
  checkSourceRefs(push, file, passage);
  if (key !== null) checkNoteVerses(push, file, passage, key);
  checkCitations(push, file, passage);
  checkUnique(
    push,
    file,
    '/claims',
    passage.claims.map((claim) => claim.id),
    'claim id',
  );
  checkUnique(
    push,
    file,
    '/translationNotes',
    passage.translationNotes.map((note) => note.id),
    'translation-note id',
  );
  checkUnique(
    push,
    file,
    '/sources',
    passage.sources.map((source) => source.id),
    'source id',
  );
  checkReview(push, file, passage, config);
  checkProvenance(push, file, passage);
  return items;
}
