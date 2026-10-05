/**
 * robots.txt (RFC 9309): parsing, rule matching, and a per-origin cache.
 *
 * The group for the fetcher's product token (`lectiobot`) applies if there is one, otherwise the `*` group. The
 * longest matching `Allow`/`Disallow` pattern wins and `Allow` wins a tie; `*` matches any run of characters and a
 * trailing `$` anchors the end (matched without regular expressions, so a hostile file cannot cause backtracking).
 * Following the RFC, a robots.txt that answers 4xx allows everything, one that answers 5xx or 429 (after retries)
 * disallows everything for now (not cached, so the next fetch asks again), and only the first 500 KiB are parsed.
 */
import type { Clock } from '@lectio/providers';
import { ProviderError } from '@lectio/providers';

import type { HttpClient } from './http.ts';

interface Rule {
  readonly allow: boolean;
  readonly pattern: string;
}

export interface RobotsRules {
  /** Whether the path (with its query string) may be fetched. */
  allows(pathAndQuery: string): boolean;
}

export const ALLOW_ALL: RobotsRules = { allows: () => true };
export const DISALLOW_ALL: RobotsRules = { allows: (path) => path === '/robots.txt' };

/** The product token robots.txt groups match: the User-Agent up to its first space or slash, lower case. */
export function productToken(userAgent: string): string {
  return (userAgent.split(/[\s/]/u)[0] as string).toLowerCase();
}

/**
 * Whether a robots.txt path pattern matches `path`: literal text between `*`s must appear in order, the first part at
 * the start and, with a trailing `$`, the last part at the end. Greedy leftmost matching is exact for `*`-only
 * patterns and runs in O(pattern × path) at worst, without backtracking.
 */
export function patternMatches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith('$');
  const parts = (anchored ? pattern.slice(0, -1) : pattern).split('*');
  const first = parts[0] as string;
  if (!path.startsWith(first)) return false;
  if (parts.length === 1) return !anchored || path.length === first.length;
  const last = parts[parts.length - 1] as string;
  let position = first.length;
  for (const part of parts.slice(1, -1)) {
    const at = path.indexOf(part, position);
    if (at < 0) return false;
    position = at + part.length;
  }
  if (anchored) return path.length - last.length >= position && path.endsWith(last);
  return path.indexOf(last, position) >= 0;
}

/** RFC 9309 asks crawlers to parse at least the first 500 KiB of a robots.txt; the rest is ignored. */
export const ROBOTS_MAX_BYTES = 500 * 1024;

interface Group {
  readonly agents: string[];
  readonly rules: Rule[];
}

/** Parses a robots.txt body into the rules that apply to `userAgent`. */
export function parseRobots(text: string, userAgent: string): RobotsRules {
  const groups: Group[] = [];
  let current: Group | undefined;
  let inAgentLines = false;
  for (const raw of text.split(/\r\n|\r|\n/u)) {
    const line = (raw.split('#')[0] as string).trim();
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (key === 'user-agent') {
      if (current === undefined || !inAgentLines) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      inAgentLines = true;
    } else if (key === 'allow' || key === 'disallow') {
      inAgentLines = false;
      if (current !== undefined && value !== '') {
        current.rules.push({ allow: key === 'allow', pattern: value });
      }
    }
  }
  const token = productToken(userAgent);
  const own = groups.filter((group) => group.agents.includes(token));
  const chosen = own.length > 0 ? own : groups.filter((group) => group.agents.includes('*'));
  const rules = chosen.flatMap((group) => group.rules);
  return {
    allows(pathAndQuery) {
      if (pathAndQuery === '/robots.txt') return true;
      let best: Rule | undefined;
      for (const rule of rules) {
        if (!patternMatches(rule.pattern, pathAndQuery)) continue;
        const longer = best === undefined || rule.pattern.length > best.pattern.length;
        const tieAllow = best !== undefined && rule.pattern.length === best.pattern.length && rule.allow;
        if (longer || tieAllow) best = rule;
      }
      return best?.allow ?? true;
    },
  };
}

/** A fetch refused because the site's robots.txt disallows it for LectioBot. Not retryable. */
export class RobotsDisallowedError extends ProviderError {
  override readonly name: string = 'RobotsDisallowedError';
  readonly url: string;

  constructor(url: string) {
    super('unsupported', `robots.txt disallows fetching ${url}`, { retryable: false });
    this.url = url;
  }
}

interface Cached {
  readonly rules: Promise<RobotsRules>;
  readonly expiresAt: number;
}

/** Fetches and caches each origin's robots.txt in memory for `ttlMs`. Concurrent lookups share one request. */
export class RobotsCache {
  readonly #http: HttpClient;
  readonly #clock: Clock;
  readonly #ttlMs: number;
  readonly #origins = new Map<string, Cached>();

  constructor(http: HttpClient, clock: Clock, ttlMs: number) {
    this.#http = http;
    this.#clock = clock;
    this.#ttlMs = ttlMs;
  }

  /** Throws {@link RobotsDisallowedError} unless robots.txt allows `url`. */
  async check(url: URL): Promise<void> {
    const rules = await this.rulesFor(url.origin);
    if (!rules.allows(`${url.pathname}${url.search}`)) throw new RobotsDisallowedError(url.href);
  }

  async rulesFor(origin: string): Promise<RobotsRules> {
    const now = this.#clock.now().getTime();
    const cached = this.#origins.get(origin);
    if (cached !== undefined && cached.expiresAt > now) return cached.rules;
    const loaded = this.#load(origin);
    const rules = loaded.then((result) => result.rules);
    this.#origins.set(origin, { rules, expiresAt: now + this.#ttlMs });
    // Network failures and temporary refusals (429, 5xx) are not cached: the next fetch asks again.
    loaded.then(
      (result) => {
        if (result.temporary) this.#origins.delete(origin);
      },
      () => this.#origins.delete(origin),
    );
    return rules;
  }

  async #load(origin: string): Promise<{ readonly rules: RobotsRules; readonly temporary: boolean }> {
    const result = await this.#http.get(`${origin}/robots.txt`, {
      accept: 'text/plain',
      maxBytes: ROBOTS_MAX_BYTES,
      overflow: 'truncate',
    });
    if (result.status === 429 || result.status >= 500) return { rules: DISALLOW_ALL, temporary: true };
    if (result.status >= 400) return { rules: ALLOW_ALL, temporary: false };
    return { rules: parseRobots(new TextDecoder().decode(result.body), this.#http.userAgent), temporary: false };
  }
}
