import type { ModelPrice } from '@lectio/config';

import { BudgetExceededError, ProviderError } from './errors.ts';

/** Token and tool usage of one LLM call, as billed. */
export interface LlmUsage {
  /** Uncached input tokens. */
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** Input tokens read from the prompt cache (billed at `cachedInputPerMTok`). */
  readonly cachedInputTokens?: number;
  /** Server-side web searches the model ran. */
  readonly webSearches?: number;
}

/** One recorded charge. */
export interface CostEntry {
  /** The meter the charge was made on (a child meter's charges show its own label). */
  readonly meter: string;
  readonly note: string;
  readonly usd: number;
  readonly model?: string;
  readonly usage?: LlmUsage;
}

/**
 * Tracks spend against a ceiling. Every charge is recorded (the money is spent either
 * way); a charge that takes this meter or any parent past its ceiling then throws
 * {@link BudgetExceededError}, which stops the run.
 */
export interface CostMeter {
  readonly label: string;
  /** `Infinity` when the meter has no ceiling. */
  readonly ceilingUsd: number;
  spentUsd(): number;
  remainingUsd(): number;
  /** USD cost of `usage` on `model`, from `config.pricing`. Throws for an unpriced model. */
  price(model: string, usage: LlmUsage): number;
  /** Records the cost of one LLM call and returns it. */
  chargeUsage(model: string, usage: LlmUsage, note?: string): number;
  /** Records a flat USD amount (for example TTS characters) and returns it. */
  chargeUsd(usd: number, note: string): number;
  /** Throws {@link BudgetExceededError} when nothing is left, so a caller can stop before starting more work. */
  assertWithinBudget(): void;
  /** A child meter (for example per passage) whose charges also count against this one. */
  scope(label: string, ceilingUsd?: number): CostMeter;
  /** Every charge made on this meter and its children, oldest first. */
  entries(): readonly CostEntry[];
}

export interface CostMeterOptions {
  /** Prices by model id (`config.pricing`). */
  readonly pricing: Readonly<Record<string, ModelPrice>>;
  readonly ceilingUsd?: number;
  readonly label?: string;
}

const PER_MILLION = 1_000_000;

/** Rounds to a millionth of a dollar so sums stay deterministic across platforms. */
function roundUsd(usd: number): number {
  return Math.round(usd * PER_MILLION) / PER_MILLION;
}

function checkCount(name: string, value: number | undefined): number {
  const count = value ?? 0;
  if (!Number.isFinite(count) || count < 0) {
    throw new ProviderError('invalid-request', `usage.${name} must be a non-negative number, got ${String(value)}`);
  }
  return count;
}

class Meter implements CostMeter {
  readonly label: string;
  readonly ceilingUsd: number;
  readonly #pricing: Readonly<Record<string, ModelPrice>>;
  readonly #parent: Meter | undefined;
  readonly #entries: CostEntry[] = [];
  #spent = 0;

  constructor(pricing: Readonly<Record<string, ModelPrice>>, label: string, ceilingUsd: number, parent?: Meter) {
    if (!(ceilingUsd >= 0)) throw new RangeError(`ceilingUsd must be >= 0, got ${String(ceilingUsd)}`);
    this.#pricing = pricing;
    this.label = label;
    this.ceilingUsd = ceilingUsd;
    this.#parent = parent;
  }

  spentUsd(): number {
    return this.#spent;
  }

  remainingUsd(): number {
    return Math.max(0, roundUsd(this.ceilingUsd - this.#spent));
  }

  price(model: string, usage: LlmUsage): number {
    const price = this.#pricing[model];
    if (price === undefined)
      throw new ProviderError('invalid-request', `no price for model "${model}" in config.pricing`);
    const input = checkCount('inputTokens', usage.inputTokens);
    const output = checkCount('outputTokens', usage.outputTokens);
    const cached = checkCount('cachedInputTokens', usage.cachedInputTokens);
    const searches = checkCount('webSearches', usage.webSearches);
    if (searches > 0 && price.webSearchPerThousand === undefined) {
      throw new ProviderError('invalid-request', `no web search price for model "${model}" in config.pricing`);
    }
    const usd =
      (input * price.inputPerMTok +
        output * price.outputPerMTok +
        cached * (price.cachedInputPerMTok ?? price.inputPerMTok)) /
        PER_MILLION +
      (searches * (price.webSearchPerThousand ?? 0)) / 1000;
    return roundUsd(usd);
  }

  chargeUsage(model: string, usage: LlmUsage, note = `llm:${model}`): number {
    const usd = this.price(model, usage);
    this.#record({ meter: this.label, note, usd, model, usage });
    return usd;
  }

  chargeUsd(usd: number, note: string): number {
    if (!Number.isFinite(usd) || usd < 0)
      throw new ProviderError('invalid-request', `cannot charge ${String(usd)} USD`);
    const rounded = roundUsd(usd);
    this.#record({ meter: this.label, note, usd: rounded });
    return rounded;
  }

  assertWithinBudget(): void {
    for (const meter of this.#lineage()) {
      if (meter.#spent >= meter.ceilingUsd) throw new BudgetExceededError(meter.label, meter.ceilingUsd, meter.#spent);
    }
  }

  scope(label: string, ceilingUsd = Infinity): CostMeter {
    return new Meter(this.#pricing, label, ceilingUsd, this);
  }

  entries(): readonly CostEntry[] {
    return [...this.#entries];
  }

  #record(entry: CostEntry): void {
    const lineage = this.#lineage();
    for (const meter of lineage) {
      meter.#entries.push(entry);
      meter.#spent = roundUsd(meter.#spent + entry.usd);
    }
    for (const meter of lineage) {
      if (meter.#spent > meter.ceilingUsd) throw new BudgetExceededError(meter.label, meter.ceilingUsd, meter.#spent);
    }
  }

  /** This meter and its ancestors, innermost first. */
  #lineage(): Meter[] {
    const parent = this.#parent;
    return parent ? [this, ...parent.#lineage()] : [this];
  }
}

/** A cost meter priced from `config.pricing`. Without `ceilingUsd` it only records. */
export function createCostMeter(options: CostMeterOptions): CostMeter {
  return new Meter(options.pricing, options.label ?? 'run', options.ceilingUsd ?? Infinity);
}
