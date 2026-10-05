/** The time source. Code that stamps dates (provenance, `retrievedAt`, events) reads it from here. */
export interface Clock {
  /** The current instant. Each call returns a fresh `Date`. */
  now(): Date;
}

/** The real wall clock. Consumers inject it at the edge (`live.clock`); tests keep the fake. */
export const systemClock: Clock = {
  now: () => new Date(),
};

/** The instant every fake clock starts at unless told otherwise. */
export const FAKE_EPOCH = '2026-01-01T00:00:00.000Z';

export interface FakeClockOptions {
  /** Start instant (ISO string or epoch ms). Defaults to {@link FAKE_EPOCH}. */
  readonly start?: string | number;
  /** Milliseconds added after every `now()` call, so successive stamps are strictly ordered. Default 0. */
  readonly stepMs?: number;
}

/** A clock that only moves when told to (or by a fixed step per read). */
export class FakeClock implements Clock {
  #ms: number;
  readonly #stepMs: number;

  constructor(options: FakeClockOptions = {}) {
    const start = options.start ?? FAKE_EPOCH;
    this.#ms = typeof start === 'number' ? start : Date.parse(start);
    if (Number.isNaN(this.#ms)) throw new RangeError(`invalid fake clock start: ${String(start)}`);
    this.#stepMs = options.stepMs ?? 0;
  }

  now(): Date {
    const date = new Date(this.#ms);
    this.#ms += this.#stepMs;
    return date;
  }

  /** Moves the clock forward. */
  advance(ms: number): void {
    if (ms < 0) throw new RangeError('a fake clock never runs backwards');
    this.#ms += ms;
  }

  /** Jumps to an instant at or after the current one. */
  set(to: string | number): void {
    const ms = typeof to === 'number' ? to : Date.parse(to);
    if (Number.isNaN(ms) || ms < this.#ms) throw new RangeError(`cannot set fake clock to ${String(to)}`);
    this.#ms = ms;
  }
}
