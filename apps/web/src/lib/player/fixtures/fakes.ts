/**
 * Fakes for the player tests (L-085): a playback adapter that records calls and lets a test fire its events, an
 * in-memory storage, an audio element and a speech engine. Nothing here touches a browser API.
 */
import type { AudioElementLike } from '../audio-adapter.ts';
import type { AdapterEvents, LoadOptions, PlaybackAdapter, Source, Track } from '../queue.ts';
import type { SpeechSynthesisLike, UtteranceLike } from '../speech-adapter.ts';
import type { VoiceLike } from '../locale.ts';

export function track(id: string, audio: string | null = null, script = 'One sentence. Another sentence.'): Track {
  return { id, title: `Title ${id}`, locale: 'en', script, audio: audio === null ? null : { url: audio } };
}

/** A playback adapter whose events the test fires. */
export class FakeAdapter implements PlaybackAdapter {
  readonly calls: string[] = [];
  events: AdapterEvents | null = null;
  loaded: { track: Track; options: LoadOptions } | null = null;
  /** Every `events` object ever bound, so a test can fire a stale one. */
  readonly bound: AdapterEvents[] = [];

  readonly kind: Source;
  private readonly accepts: (track: Track) => boolean;

  constructor(kind: Source, accepts?: (track: Track) => boolean) {
    this.kind = kind;
    this.accepts = accepts ?? (kind === 'audio' ? (candidate) => candidate.audio !== null : () => true);
  }

  supports(candidate: Track): boolean {
    return this.accepts(candidate);
  }

  load(candidate: Track, options: LoadOptions, events: AdapterEvents): void {
    this.calls.push(`load ${candidate.id} @${options.position} x${options.rate}`);
    this.loaded = { track: candidate, options };
    this.events = events;
    this.bound.push(events);
  }

  play(): void {
    this.calls.push('play');
  }

  pause(): void {
    this.calls.push('pause');
  }

  seek(position: number): void {
    this.calls.push(`seek ${position}`);
  }

  setRate(rate: number): void {
    this.calls.push(`rate ${rate}`);
  }

  stop(): void {
    this.calls.push('stop');
  }
}

/** `localStorage` in memory; `failWrites` makes `setItem` throw, `failReads` makes `getItem` throw. */
export class MemoryStorage {
  readonly items = new Map<string, string>();
  failWrites = false;
  failReads = false;

  getItem(key: string): string | null {
    if (this.failReads) throw new Error('blocked');
    return this.items.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.failWrites) throw new Error('quota');
    this.items.set(key, value);
  }
}

type Listener = () => void;

/** An `HTMLAudioElement` stand-in: `fire` dispatches an event, `playResult` decides what `play()` returns. */
export class FakeAudio implements AudioElementLike {
  src = '';
  currentTime = 0;
  duration = Number.NaN;
  playbackRate = 1;
  defaultPlaybackRate = 1;
  preservesPitch = false;
  readyState = 0;
  playResult: () => Promise<void> = () => Promise.resolve();
  readonly calls: string[] = [];
  private readonly listeners = new Map<string, Set<Listener>>();

  play(): Promise<void> {
    this.calls.push(`play ${this.src}`);
    return this.playResult();
  }

  pause(): void {
    this.calls.push('pause');
  }

  load(): void {
    this.calls.push(`load ${this.src}`);
  }

  removeAttribute(name: string): void {
    if (name === 'src') this.src = '';
  }

  addEventListener(type: string, listener: Listener): void {
    const set = this.listeners.get(type) ?? new Set<Listener>();
    set.add(listener);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }

  fire(type: string): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener();
  }

  listenerCount(): number {
    return [...this.listeners.values()].reduce((sum, set) => sum + set.size, 0);
  }
}

export class FakeUtterance implements UtteranceLike {
  lang = '';
  rate = 1;
  voice: VoiceLike | null = null;
  onstart: ((event: unknown) => void) | null = null;
  onend: ((event: unknown) => void) | null = null;
  onerror: ((event: { readonly error?: string }) => void) | null = null;
  onboundary: ((event: { readonly charIndex: number }) => void) | null = null;

  text: string;

  constructor(text: string) {
    this.text = text;
  }
}

/** A speech engine that keeps every utterance; the test ends or fails them. `cancel` raises `interrupted`. */
export class FakeSynth implements SpeechSynthesisLike {
  readonly spoken: FakeUtterance[] = [];
  cancels = 0;
  voices: VoiceLike[] = [
    { name: 'Daniel', lang: 'en-GB' },
    { name: 'Zuri', lang: 'sw-KE' },
  ];

  speak(utterance: UtteranceLike): void {
    this.spoken.push(utterance as FakeUtterance);
  }

  cancel(): void {
    this.cancels += 1;
    this.last()?.onerror?.({ error: 'interrupted' });
  }

  getVoices(): readonly VoiceLike[] {
    return this.voices;
  }

  last(): FakeUtterance | undefined {
    return this.spoken.at(-1);
  }
}

/** A timer the test fires by hand: `pending` holds the callbacks not cleared yet. */
export class FakeTimer {
  readonly pending = new Map<number, () => void>();
  private next = 0;

  set(callback: () => void): unknown {
    this.next += 1;
    this.pending.set(this.next, callback);
    return this.next;
  }

  clear(handle: unknown): void {
    this.pending.delete(handle as number);
  }

  /** Runs every pending callback. */
  fire(): void {
    const callbacks = [...this.pending.values()];
    this.pending.clear();
    for (const callback of callbacks) callback();
  }
}

/** Lets pending promise callbacks run. */
export async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}
