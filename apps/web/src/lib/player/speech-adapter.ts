/**
 * The device-speech playback adapter (L-085): reads a segment's script with the Web Speech API
 * (`speechSynthesis`), the player's fallback when a segment has no audio file or its file fails.
 *
 * - Each segment is read in its own language with a voice of that language (`speechSettings` in locale.ts, L-113):
 *   a Kiswahili segment with a Kiswahili voice, an English fallback on a Kiswahili page in English.
 * - The queue's speed is the utterance `rate`. An utterance's rate cannot change while it is spoken, so a new speed
 *   restarts reading from the current word.
 * - The script is read in sentence-sized chunks: some engines stop long utterances after about 15 seconds, and
 *   chunks give natural restart points.
 * - Positions are estimated from characters read (`SPEECH_CHARS_PER_SECOND`), advanced by `boundary` events where
 *   the engine sends them and at the end of every chunk. Seeking restarts reading at the word nearest that point.
 * - Pausing cancels and remembers the point, then resuming speaks from it: `speechSynthesis.pause()` is unreliable
 *   on Android and with network voices. Callbacks from a cancelled utterance are ignored.
 */
import { speechSettings } from './locale.ts';
import type { VoiceLike } from './locale.ts';
import { SPEECH_CHARS_PER_SECOND, speechDuration } from './queue.ts';
import type { AdapterEvents, LoadOptions, PlaybackAdapter, Track } from './queue.ts';

/** The parts of a `SpeechSynthesisUtterance` the adapter sets and listens to. */
export interface UtteranceLike {
  text: string;
  lang: string;
  rate: number;
  voice: VoiceLike | null;
  onend: ((event: unknown) => void) | null;
  onerror: ((event: { readonly error?: string }) => void) | null;
  onboundary: ((event: { readonly charIndex: number }) => void) | null;
}

/** The parts of `speechSynthesis` the adapter uses. */
export interface SpeechSynthesisLike {
  speak(utterance: UtteranceLike): void;
  cancel(): void;
  getVoices(): readonly VoiceLike[];
}

export interface SpeechEnvironment {
  readonly synth: SpeechSynthesisLike;
  /** `new SpeechSynthesisUtterance(text)`. */
  readonly utterance: (text: string) => UtteranceLike;
}

/** Chunks are cut at sentence ends and kept below this many characters where a sentence allows. */
export const CHUNK_LENGTH = 220;

/** One piece of the script read as one utterance, and where it starts in the script. */
export interface Chunk {
  readonly start: number;
  readonly text: string;
}

/** `script` cut into sentence chunks of up to `CHUNK_LENGTH` characters (a longer sentence stays whole). */
export function chunkScript(script: string, length = CHUNK_LENGTH): Chunk[] {
  const ends = [...script.matchAll(/[.!?]+["'”’)]*\s+/g)].map((match) => match.index + match[0].length);
  const cuts = [0, ...ends.filter((end) => end < script.length), script.length];
  const chunks: Chunk[] = [];
  let start = 0;
  for (let i = 1; i < cuts.length; i += 1) {
    const sentenceStart = cuts[i - 1] as number;
    const end = cuts[i] as number;
    if (sentenceStart > start && end - start > length) {
      chunks.push({ start, text: script.slice(start, sentenceStart) });
      start = sentenceStart;
    }
  }
  if (script.length > start) chunks.push({ start, text: script.slice(start) });
  return chunks;
}

/** The start of the word at or before `offset` in `script` (so reading never starts mid-word). */
export function wordStart(script: string, offset: number): number {
  let at = Math.max(0, Math.min(script.length, Math.round(offset)));
  while (at > 0 && !/\s/.test(script.charAt(at - 1))) at -= 1;
  return at;
}

/** Errors a `cancel()` raises on the cancelled utterance: not failures. */
const CANCEL_ERRORS = new Set(['interrupted', 'canceled']);

/** The speech adapter, or `null` when the browser has no speech synthesis. */
export function createSpeechAdapter(env: SpeechEnvironment | null): PlaybackAdapter | null {
  if (env === null) return null;
  const { synth, utterance: makeUtterance } = env;
  let track: Track | null = null;
  let chunks: Chunk[] = [];
  let events: AdapterEvents | null = null;
  let rate = 1;
  /** Characters of the script already read (the playback point). */
  let offset = 0;
  let speaking = false;
  /** Bumped whenever reading stops or restarts, so a cancelled utterance's callbacks are dropped. */
  let generation = 0;

  /** Only called while a track is loaded (`track` and `events` are set and cleared together). */
  const bound = (): AdapterEvents => events as AdapterEvents;
  const report = (): void => bound().time(offset / SPEECH_CHARS_PER_SECOND, speechDuration((track as Track).script));

  /** Speaks from `offset` to the end, chunk after chunk. */
  function speakFrom(token: number): void {
    const current = track as Track;
    const chunk = chunks.find((candidate) => offset < candidate.start + candidate.text.length);
    if (chunk === undefined) {
      speaking = false;
      offset = current.script.length;
      report();
      bound().ended();
      return;
    }
    const from = Math.max(offset, chunk.start);
    const text = current.script.slice(from, chunk.start + chunk.text.length);
    const utterance = makeUtterance(text);
    const settings = speechSettings(current, synth.getVoices());
    utterance.lang = settings.lang;
    if (settings.voice !== null) utterance.voice = settings.voice;
    utterance.rate = rate;
    utterance.onboundary = (event) => {
      if (token !== generation) return;
      offset = from + event.charIndex;
      report();
    };
    utterance.onend = () => {
      if (token !== generation) return;
      offset = chunk.start + chunk.text.length;
      report();
      speakFrom(token);
    };
    utterance.onerror = (event) => {
      if (token !== generation || CANCEL_ERRORS.has(event.error ?? '')) return;
      speaking = false;
      generation += 1;
      bound().error();
    };
    synth.speak(utterance);
  }

  function halt(): void {
    generation += 1;
    if (speaking) synth.cancel();
    speaking = false;
  }

  function start(): void {
    halt();
    speaking = true;
    offset = wordStart((track as Track).script, offset);
    speakFrom(generation);
  }

  return {
    kind: 'speech',
    supports: (candidate) => candidate.script.trim() !== '',
    load(next: Track, options: LoadOptions, bound: AdapterEvents) {
      halt();
      track = next;
      chunks = chunkScript(next.script);
      events = bound;
      rate = options.rate;
      offset = wordStart(next.script, options.position * SPEECH_CHARS_PER_SECOND);
      report();
    },
    play() {
      if (track === null || speaking) return;
      start();
      bound().playing();
    },
    pause() {
      halt();
    },
    seek(position) {
      if (track === null) return;
      offset = wordStart(track.script, position * SPEECH_CHARS_PER_SECOND);
      if (speaking) start();
      report();
    },
    setRate(next) {
      rate = next;
      if (speaking) start();
    },
    stop() {
      halt();
      track = null;
      events = null;
    },
  };
}

/** The browser's speech synthesis, or `null` where there is none. */
export function browserSpeech(scope: {
  speechSynthesis?: SpeechSynthesisLike;
  SpeechSynthesisUtterance?: new (text: string) => UtteranceLike;
}): SpeechEnvironment | null {
  const { speechSynthesis: synth, SpeechSynthesisUtterance: Utterance } = scope;
  if (synth === undefined || Utterance === undefined) return null;
  return { synth, utterance: (text) => new Utterance(text) };
}
