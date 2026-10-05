/**
 * The last resort of pre-validation: when repairs run out, drop only what fails. Each error
 * finding is traced to a claim, a translation note or (when no claim cites it) a source; any
 * finding that cannot be traced (the summary, a context title, provenance, an uncited sentence)
 * means the draft cannot be saved by dropping, and it is abandoned.
 *
 * Dropping a claim removes its markers and every sentence that cited nothing else; a paragraph or
 * note body left empty goes too. Dropping a note removes it whole. Claims and sources that were
 * cited before and no longer are after the drop are removed with them, so the file never gains an
 * orphan. Whether what remains is still a valid passage is for the gates to say.
 */
import type { GateResultItem } from '@lectio/gates';
import type { Passage } from '@lectio/schema/passage';

export type DropKind = 'claim' | 'note' | 'source';

export interface DropTarget {
  readonly kind: DropKind;
  /** The claim, note or source id. */
  readonly id: string;
  /** The finding that made it fail (`rule: message`), or why it went with another drop. */
  readonly reason: string;
}

export type DropPlan =
  | { readonly ok: true; readonly targets: readonly DropTarget[] }
  | { readonly ok: false; readonly unattributable: readonly GateResultItem[] };

const NOTE_POINTER = /^\/translationNotes\/(\d+)(?:\/|$)/u;
const CLAIM_POINTER = /^\/claims\/(\d+)(?:\/|$)/u;
const SOURCE_POINTER = /^\/sources\/(\d+)(?:\/|$)/u;
const MARKER = /\[(c[1-9][0-9]*)\]/gu;
/** One cited chunk of prose: the text up to a run of claim markers, and the run. */
const CHUNK = /[^[\]]+(?:\[c[1-9][0-9]*\])+/gu;

const indexIn = (pattern: RegExp, pointer: string): number | undefined => {
  const match = pattern.exec(pointer);
  return match === null ? undefined : Number(match[1]);
};

const reasonOf = (item: GateResultItem): string => `${item.ruleId}: ${item.message}`;

/** What each error finding is about, or the findings no drop can fix. */
export function planDrops(passage: Passage, errors: readonly GateResultItem[]): DropPlan {
  const targets = new Map<string, DropTarget>();
  const unattributable: GateResultItem[] = [];
  const add = (kind: DropKind, id: string, item: GateResultItem): void => {
    const key = `${kind}:${id}`;
    if (!targets.has(key)) targets.set(key, { kind, id, reason: reasonOf(item) });
  };
  for (const item of errors) {
    const pointer = item.pointer;
    const note = passage.translationNotes[indexIn(NOTE_POINTER, pointer) ?? -1];
    if (note !== undefined) {
      add('note', note.id, item);
      continue;
    }
    const claimId =
      item.claimId !== undefined && passage.claims.some((claim) => claim.id === item.claimId)
        ? item.claimId
        : passage.claims[indexIn(CLAIM_POINTER, pointer) ?? -1]?.id;
    if (claimId !== undefined) {
      add('claim', claimId, item);
      continue;
    }
    const source = passage.sources[indexIn(SOURCE_POINTER, pointer) ?? -1];
    if (source !== undefined) {
      const citing = passage.claims.filter((claim) => claim.sourceIds.includes(source.id));
      if (citing.length === 0) add('source', source.id, item);
      for (const claim of citing) add('claim', claim.id, item);
      continue;
    }
    unattributable.push(item);
  }
  return unattributable.length > 0 ? { ok: false, unattributable } : { ok: true, targets: [...targets.values()] };
}

/** Claim ids cited in `text`. */
function markersIn(text: string): string[] {
  return [...text.matchAll(MARKER)].map((match) => match[1] as string);
}

/** `text` without the markers of `dropped`, and without sentences that cite nothing else. */
export function stripClaims(text: string, dropped: ReadonlySet<string>): string {
  const chunks = text.match(CHUNK) ?? [];
  if (chunks.join('') !== text) return text; // not marker-shaped prose; the schema gate reports it
  return chunks
    .map((chunk) => {
      const prose = chunk.replace(MARKER, '');
      const kept = markersIn(chunk).filter((id) => !dropped.has(id));
      return kept.length === 0 ? '' : `${prose}${kept.map((id) => `[${id}]`).join('')}`;
    })
    .join('')
    .trim();
}

function citedClaims(passage: Pick<Passage, 'context' | 'translationNotes'>): Set<string> {
  return new Set(
    [...passage.context.paragraphs, ...passage.translationNotes.map((note) => note.body)].flatMap(markersIn),
  );
}

function citedSources(claims: Passage['claims']): Set<string> {
  return new Set(claims.flatMap((claim) => claim.sourceIds));
}

export interface DropResult {
  /** The passage without the dropped items (not yet checked; run the gates on it). */
  readonly passage: Passage;
  /** Everything removed: the targets and what went with them, in passage order per kind. */
  readonly dropped: readonly DropTarget[];
}

/** Removes `targets` and whatever they leave uncited. */
export function applyDrops(passage: Passage, targets: readonly DropTarget[]): DropResult {
  const reasons = new Map(targets.map((target) => [`${target.kind}:${target.id}`, target.reason]));
  const ids = (kind: DropKind): Set<string> =>
    new Set(targets.filter((target) => target.kind === kind).map((target) => target.id));
  const droppedClaims = ids('claim');
  const droppedNotes = ids('note');
  const droppedSources = ids('source');
  const dropped: DropTarget[] = [];
  const record = (kind: DropKind, id: string, fallback: string): void => {
    dropped.push({ kind, id, reason: reasons.get(`${kind}:${id}`) ?? fallback });
  };

  const paragraphs = passage.context.paragraphs
    .map((paragraph) => stripClaims(paragraph, droppedClaims))
    .filter((paragraph) => paragraph !== '');
  const notes: Passage['translationNotes'][number][] = [];
  for (const note of passage.translationNotes) {
    if (droppedNotes.has(note.id)) {
      record('note', note.id, '');
      continue;
    }
    const body = stripClaims(note.body, droppedClaims);
    if (body === '') record('note', note.id, 'every sentence of its body cited a dropped claim');
    else notes.push(body === note.body ? note : { ...note, body });
  }
  const context = { ...passage.context, paragraphs };

  const citedBefore = citedClaims(passage);
  const citedAfter = citedClaims({ context, translationNotes: notes });
  const claims = passage.claims.filter((claim) => {
    if (droppedClaims.has(claim.id)) {
      record('claim', claim.id, '');
      return false;
    }
    if (citedBefore.has(claim.id) && !citedAfter.has(claim.id)) {
      record('claim', claim.id, 'only a dropped note or sentence cited it');
      return false;
    }
    return true;
  });

  const sourcesBefore = citedSources(passage.claims);
  const sourcesAfter = citedSources(claims);
  const sources = passage.sources.filter((source) => {
    if (droppedSources.has(source.id)) {
      record('source', source.id, '');
      return false;
    }
    if (sourcesBefore.has(source.id) && !sourcesAfter.has(source.id)) {
      record('source', source.id, 'only dropped claims cited it');
      return false;
    }
    return true;
  });

  return { passage: { ...passage, context, translationNotes: notes, claims, sources }, dropped };
}
