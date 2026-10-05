/**
 * SSRF guard. The content gates fetch URLs taken from pull-request content inside a CI runner, so every request
 * (the first and every redirect hop, robots.txt included) must go to a public address: never loopback, private
 * (RFC 1918), link-local (cloud metadata at 169.254.169.254), CGNAT, unique-local, unspecified, multicast or
 * reserved addresses, whether the URL names one literally or a hostname resolves to one.
 *
 * The guard resolves the hostname and then lets fetch resolve it again, so a DNS-rebinding window remains; closing
 * it would need a pinning dispatcher (undici), which this package does not depend on.
 */
import { lookup } from 'node:dns/promises';
import { isIPv4, isIPv6 } from 'node:net';

import { ProviderError } from '@lectio/providers';

/** Resolves a hostname to all its addresses. Injectable so tests stay offline. */
export type ResolveHost = (hostname: string) => Promise<readonly string[]>;

export const systemResolveHost: ResolveHost = async (hostname) =>
  (await lookup(hostname, { all: true, verbatim: true })).map((entry) => entry.address);

/** IPv4 ranges that are never public, as [first octets, prefix length]. */
const BLOCKED_V4: readonly (readonly [number, number, number, number, number])[] = [
  [0, 0, 0, 0, 8], // "this network", unspecified
  [10, 0, 0, 0, 8], // private
  [100, 64, 0, 0, 10], // CGNAT
  [127, 0, 0, 0, 8], // loopback
  [169, 254, 0, 0, 16], // link-local, cloud metadata
  [172, 16, 0, 0, 12], // private
  [192, 0, 0, 0, 24], // IETF protocol assignments
  [192, 0, 2, 0, 24], // documentation
  [192, 168, 0, 0, 16], // private
  [198, 18, 0, 0, 15], // benchmarking
  [198, 51, 100, 0, 24], // documentation
  [203, 0, 113, 0, 24], // documentation
  [224, 0, 0, 0, 4], // multicast
  [240, 0, 0, 0, 4], // reserved, broadcast
];

function v4Number(ip: string): number {
  return ip.split('.').reduce((n, octet) => n * 256 + Number(octet), 0);
}

function blockedV4(ip: string): boolean {
  const n = v4Number(ip);
  return BLOCKED_V4.some(([a, b, c, d, bits]) => {
    const size = 2 ** (32 - bits);
    const start = v4Number(`${a}.${b}.${c}.${d}`);
    return n >= start && n < start + size;
  });
}

/** The eight 16-bit groups of an IPv6 address (a dotted IPv4 tail allowed). */
function v6Groups(ip: string): number[] {
  let text = ip.toLowerCase().split('%')[0] as string;
  const tail = /(\d+\.\d+\.\d+\.\d+)$/u.exec(text)?.[1];
  if (tail !== undefined) {
    const n = v4Number(tail);
    text = `${text.slice(0, -tail.length)}${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const [head, rest] = text.split('::') as [string, string | undefined];
  const parse = (part: string): number[] => (part === '' ? [] : part.split(':').map((group) => parseInt(group, 16)));
  const left = parse(head);
  if (rest === undefined) return left;
  const right = parse(rest);
  return [...left, ...Array<number>(8 - left.length - right.length).fill(0), ...right];
}

function embeddedV4(g: readonly number[]): string {
  const [hi, lo] = [g[6] as number, g[7] as number];
  return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
}

function blockedV6(ip: string): boolean {
  const g = v6Groups(ip);
  const first = g[0] as number;
  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d, which covers :: and ::1 via 0.0.0.0/8).
  if (g.slice(0, 5).every((group) => group === 0) && (g[5] === 0xffff || g[5] === 0)) return blockedV4(embeddedV4(g));
  // NAT64 (64:ff9b::/96) embeds an IPv4 address.
  if (first === 0x64 && g[1] === 0xff9b) return blockedV4(embeddedV4(g));
  return (
    (first & 0xfe00) === 0xfc00 || // unique local fc00::/7
    (first & 0xffc0) === 0xfe80 || // link-local fe80::/10
    (first & 0xffc0) === 0xfec0 || // deprecated site-local fec0::/10
    (first & 0xff00) === 0xff00 || // multicast ff00::/8
    (first === 0x2001 && g[1] === 0x0db8) // documentation 2001:db8::/32
  );
}

/** True for an IP address that is not a public unicast address (or is not an IP address at all). */
export function isBlockedAddress(ip: string): boolean {
  if (isIPv4(ip)) return blockedV4(ip);
  if (isIPv6(ip)) return blockedV6(ip);
  return true;
}

function refuse(url: URL, why: string): ProviderError {
  return new ProviderError('invalid-request', `refusing to fetch ${url.href}: ${why}`, { retryable: false });
}

/**
 * Throws a non-retryable `ProviderError('invalid-request')` unless `url`'s host is public: `localhost` and
 * `*.localhost` are refused outright, an IP literal is checked as is, and a hostname is resolved and refused if any
 * of its addresses is not public.
 */
export async function assertPublicUrl(url: URL, resolveHost: ResolveHost): Promise<void> {
  const host = url.hostname
    .replace(/^\[|\]$/gu, '')
    .replace(/\.$/u, '')
    .toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost')) throw refuse(url, 'local host name');
  if (isIPv4(host) || isIPv6(host)) {
    if (isBlockedAddress(host)) throw refuse(url, `non-public address ${host}`);
    return;
  }
  let addresses: readonly string[];
  try {
    addresses = await resolveHost(host);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ProviderError('unavailable', `GET ${url.href}: cannot resolve ${host}: ${message}`, {
      retryable: false,
      cause: error,
    });
  }
  if (addresses.length === 0) throw refuse(url, `${host} has no addresses`);
  const blocked = addresses.find(isBlockedAddress);
  if (blocked !== undefined) throw refuse(url, `${host} resolves to non-public address ${blocked}`);
}
