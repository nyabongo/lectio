/** Plain JSON objects (not arrays, not null). */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Deep-merges `override` over `base`. Objects merge key by key; arrays and
 * scalars in `override` replace the base value; `undefined` keeps the base.
 * Neither input is modified.
 */
export function deepMerge(base: unknown, override: unknown): unknown {
  if (override === undefined) return clone(base);
  if (!isPlainObject(base) || !isPlainObject(override)) return clone(override);
  const merged: Record<string, unknown> = clone(base) as Record<string, unknown>;
  for (const [key, value] of Object.entries(override)) {
    const baseValue = Object.hasOwn(base, key) ? base[key] : undefined;
    // defineProperty keeps a `__proto__` key an ordinary own property, which the schema then rejects.
    Object.defineProperty(merged, key, {
      value: deepMerge(baseValue, value),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return merged;
}

function clone(value: unknown): unknown {
  return value === undefined ? undefined : structuredClone(value);
}

/** Freezes a value and everything reachable from it. */
export function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
