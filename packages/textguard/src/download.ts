/**
 * The one external call the builder makes, behind an interface so tests use a
 * fake. `createFetchDownloader` is the live implementation, injected by the
 * `guard:build` script.
 */

export interface Downloader {
  /** Fetches the bytes at `url`; rejects on any non-2xx response. */
  download(url: string): Promise<Uint8Array>;
}

/** A downloader over a `fetch` implementation (the global one by default). */
export function createFetchDownloader(fetchImpl: typeof fetch = fetch): Downloader {
  return {
    async download(url: string): Promise<Uint8Array> {
      const response = await fetchImpl(url);
      if (!response.ok) throw new Error(`download failed: ${url} answered ${response.status}`);
      return new Uint8Array(await response.arrayBuffer());
    },
  };
}

/** A deterministic fake: serves fixed bytes per URL and fails for any other URL. */
export function createFakeDownloader(files: Readonly<Record<string, Uint8Array>>): Downloader & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    download(url: string): Promise<Uint8Array> {
      calls.push(url);
      const file = files[url];
      return file === undefined
        ? Promise.reject(new Error(`fake downloader: no file for ${url}`))
        : Promise.resolve(file);
    },
  };
}
