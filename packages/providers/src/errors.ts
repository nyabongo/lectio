/**
 * Errors every provider raises. Live implementations map their own failures onto
 * these so consumers can handle them without knowing which provider fills a slot.
 */

/** Machine-readable failure kinds shared by all providers. */
export type ProviderErrorCode =
  | 'not-found'
  | 'conflict'
  | 'rate-limited'
  | 'unavailable'
  | 'timeout'
  | 'malformed-output'
  | 'unsupported'
  | 'invalid-request'
  | 'scripted';

const RETRYABLE: ReadonlySet<ProviderErrorCode> = new Set(['rate-limited', 'unavailable', 'timeout']);

export class ProviderError extends Error {
  override readonly name: string = 'ProviderError';
  readonly code: ProviderErrorCode;
  /** True when the same call may succeed if retried later (rate limits, outages, timeouts). */
  readonly retryable: boolean;

  constructor(code: ProviderErrorCode, message: string, options: { retryable?: boolean; cause?: unknown } = {}) {
    super(message, { cause: options.cause });
    this.code = code;
    this.retryable = options.retryable ?? RETRYABLE.has(code);
  }
}

/** An LLM returned text that is not valid JSON, or JSON that does not match the response schema. */
export class LlmOutputError extends ProviderError {
  override readonly name: string = 'LlmOutputError';
  /** The raw text the model produced, for logs and repair prompts. */
  readonly rawText: string;

  constructor(message: string, rawText: string) {
    super('malformed-output', message);
    this.rawText = rawText;
  }
}

/** A charge took a cost meter past its ceiling. The run must stop. */
export class BudgetExceededError extends Error {
  override readonly name: string = 'BudgetExceededError';
  /** Label of the meter whose ceiling was hit (for example `run` or `passage:mt-20-1-16`). */
  readonly meter: string;
  readonly ceilingUsd: number;
  /** What the meter had spent after the charge that crossed the ceiling. */
  readonly spentUsd: number;

  constructor(meter: string, ceilingUsd: number, spentUsd: number) {
    super(`budget exceeded for ${meter}: spent $${spentUsd.toFixed(4)} of a $${ceilingUsd.toFixed(2)} ceiling`);
    this.meter = meter;
    this.ceilingUsd = ceilingUsd;
    this.spentUsd = spentUsd;
  }
}
