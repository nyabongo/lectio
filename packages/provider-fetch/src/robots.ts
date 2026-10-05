/**
 * robots.txt (RFC 9309): parsing, rule matching, and a per-origin cache.
 *
 * The group for the fetcher's product token (`lectiobot`) applies if there is one, otherwise the `*` group. The
 * longest matching `Allow`/`Disallow` pattern wins and `Allow` wins a tie; `*` matches any run of characters and a
 * trailing `$` anchors the end. Following the RFC, a robots.txt that answers 4xx allows everything and one that
 * answers 5xx (after retries) disallows everything.
 */
import type { Clock } from '@lectio/providers';
import { ProviderError } from '@lectio/providers';

import type { HttpClient } from './http.ts';

interface Rule {
  readonly allow: boolean;
  readonly pattern: string;
  readonly regex: RegExp;
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

function patternRegex(pattern: string): RegExp {
  const anchored = pattern.endsWith('$');
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/gu, '\\$&'))
    .join('.*');
  return new RegExp(`^${body}${anchored ? '$' : ''}`, 'u');
}

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
        current.rules.push({ allow: key === 'allow', pattern: value, regex: patternRegex(value) });
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
        if (!rule.regex.test(pathAndQuery)) continue;
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
    const rules = this.#load(origin);
    this.#origins.set(origin, { rules, expiresAt: now + this.#ttlMs });
    // A network failure is not cached: the next fetch asks again.
    rules.catch(() => this.#origins.delete(origin));
    return rules;
  }

  async #load(origin: string): Promise<RobotsRules> {
    const result = await this.#http.get(`${origin}/robots.txt`, { accept: 'text/plain' });
    if (result.status >= 500) return DISALLOW_ALL;
    if (result.status >= 300) return ALLOW_ALL;
    return parseRobots(new TextDecoder().decode(result.body), this.#http.userAgent);
  }
}
