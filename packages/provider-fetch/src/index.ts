/**
 * @lectio/provider-fetch: the live HTTP `SourceFetcher` (`LiveSourceFetcher`) and a byte downloader
 * (`LiveDownloader`) for pinned upstream files. Consumers inject them; `createProviders` never imports this package
 * (ADR 0005).
 */
export const packageName = '@lectio/provider-fetch';

export { defaultSourceCacheDir, SourceCache } from './cache.ts';
export { LiveDownloader } from './downloader.ts';
export { LiveSourceFetcher } from './fetcher.ts';
export type { LiveSourceFetcherOptions } from './fetcher.ts';
export { HttpClient, parseHttpUrl, retryAfterMs, USER_AGENT } from './http.ts';
export type { GetOptions, HttpOptions, HttpResult } from './http.ts';
export { parseRobots, productToken, RobotsCache, RobotsDisallowedError } from './robots.ts';
export type { RobotsRules } from './robots.ts';
export { charsetParam, contentKind, decodeBody, htmlToText, mediaType, metaCharset, tidyText } from './text.ts';
export type { ContentKind } from './text.ts';
export type { LiveFetchedSource, UnsupportedContent } from './types.ts';
