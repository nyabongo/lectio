/**
 * Exhaustiveness check for discriminated unions: the compiler rejects the call
 * when a case is missing, and the runtime throws if an unexpected value slips through.
 */
export function assertNever(value: never, message?: string): never {
  throw new Error(message ?? `Unexpected value: ${JSON.stringify(value)}`);
}
