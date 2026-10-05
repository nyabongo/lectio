/**
 * Sharing a day, a reading or one insight: the text people pass along and the logic behind `<ShareButton>`
 * (src/components/share/ShareButton.astro).
 *
 * The share text is three lines: the reference, a one-line insight and the link. It is what the fallback copies
 * and what the WhatsApp and email links carry; the native share sheet (`navigator.share`) gets the same reference
 * and insight as `text` with the link as `url`, so targets that join them do not repeat the link. Links never carry
 * analytics or tracking parameters: the query string is dropped. The same rules are pinned by the test vectors in
 * packages/schema/fixtures/share-text.json, which the Flutter app reuses.
 *
 * Nothing here touches the network; the browser APIs come in as arguments so the logic is unit-tested.
 */

/** Longest reference line, ellipsis included. */
export const REF_MAX_LENGTH = 100;

/** Longest insight line, ellipsis included. */
export const INSIGHT_MAX_LENGTH = 160;

const ELLIPSIS = '…';

/** What a share is built from. */
export interface ShareTextInput {
  /** The reference: a day's title and date, a reading's reference or an insight's heading. */
  readonly ref: string;
  /** A one-line insight (a reading's or a note's summary), or `null` when there is none yet. */
  readonly insight: string | null;
  /** The absolute URL of the page (http or https). */
  readonly url: string;
}

/**
 * The whitespace the share text collapses: U+0020 SPACE and U+0009–U+000D (tab, line feed, vertical tab, form feed,
 * carriage return) only. Other spaces (NBSP, U+2009, U+FEFF…) are kept as they are, so every platform agrees.
 */
const WHITESPACE_RUN = /[\t\n\v\f\r ]+/g;

/** `text` on one line: runs of whitespace (see `WHITESPACE_RUN`) become one space, and the ends are trimmed. */
export function oneLine(text: string): string {
  return text.replace(WHITESPACE_RUN, ' ').replace(/^ | $/g, '');
}

/**
 * `text` (already on one line) cut to at most `max` code points, ellipsis included. Everything counts code points:
 * the room is the first `max - 1` code points; the cut is at the last U+0020 in the room when its code-point index is
 * at least half the room's length (rounded down), else at the end of the room (mid-word). Trailing spaces and
 * `,;:.–—-` before the ellipsis are dropped.
 */
export function truncate(text: string, max: number): string {
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  const room = chars.slice(0, max - 1);
  const space = room.lastIndexOf(' ');
  const cut = (space >= Math.floor(room.length / 2) ? room.slice(0, space) : room).join('');
  return `${cut.replace(/[ ,;:.–—-]+$/u, '')}${ELLIPSIS}`;
}

/**
 * The link to share: `url` without its query string (so no analytics or tracking parameters ever travel with it);
 * the path and fragment stay. Throws a `RangeError` for anything but an absolute http(s) URL.
 */
export function cleanShareUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new RangeError(`share URL must be absolute, got ${JSON.stringify(url)}`);
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')
    throw new RangeError(`share URL must be http or https, got ${JSON.stringify(url)}`);
  parsed.search = '';
  return parsed.href;
}

/** The reference and insight lines, each on one line and within its limit (an empty insight is left out). */
export function shareLines(input: Pick<ShareTextInput, 'ref' | 'insight'>): string[] {
  const ref = truncate(oneLine(input.ref), REF_MAX_LENGTH);
  if (ref === '') throw new RangeError('share text needs a reference');
  const insight = truncate(oneLine(input.insight ?? ''), INSIGHT_MAX_LENGTH);
  return insight === '' ? [ref] : [ref, insight];
}

/** The fallback share text: reference, insight (when there is one) and link, one per line. */
export function buildShareText(input: ShareTextInput): string {
  return [...shareLines(input), cleanShareUrl(input.url)].join('\n');
}

/** The payload for `navigator.share`. */
export interface SharePayload {
  readonly title: string;
  /** Reference and insight, without the link (it travels as `url`). */
  readonly text: string;
  readonly url: string;
}

/** What `<ShareButton>` hands its script: the native payload and the fallback text. */
export interface ShareConfig {
  readonly payload: SharePayload;
  /** `buildShareText(...)`: copied by the fallback and carried by the WhatsApp and email links. */
  readonly text: string;
}

/** The native payload and the fallback text for one page; `title` is the page title. */
export function shareConfig(input: ShareTextInput & { readonly title: string }): ShareConfig {
  const url = cleanShareUrl(input.url);
  return {
    payload: { title: oneLine(input.title), text: shareLines(input).join('\n'), url },
    text: buildShareText(input),
  };
}

/** The WhatsApp share link for `text` (`https://wa.me/?text=…`). */
export function whatsappUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

/** A `mailto:` link with no recipient, `subject` and `body` filled in. */
export function mailtoUrl(subject: string, body: string): string {
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/** The one-line insight for a day: its Gospel's summary, else the first reading summary, else `null`. */
export function dayShareInsight(day: {
  readonly masses: readonly {
    readonly readings: readonly { readonly slot: string; readonly summary: string | null }[];
  }[];
}): string | null {
  const readings = day.masses.flatMap((mass) => mass.readings);
  const gospel = readings.find((reading) => reading.slot === 'gospel' && reading.summary !== null);
  return gospel?.summary ?? readings.find((reading) => reading.summary !== null)?.summary ?? null;
}

/** The parts of `navigator` that sharing uses. */
export interface ShareNavigator {
  share?: (data: SharePayload) => Promise<void>;
  canShare?: (data: SharePayload) => boolean;
}

/**
 * How a share attempt ended: `shared` (the sheet completed), `cancelled` (the person closed the sheet), `busy`
 * (an earlier share is still pending: `InvalidStateError`, nothing to do) or `fallback` (no Web Share, it refused
 * the payload, or it failed: show the fallback popover instead).
 */
export type ShareOutcome = 'shared' | 'cancelled' | 'busy' | 'fallback';

/** Opens the native share sheet when the browser has one, and says whether the fallback is needed. */
export async function nativeShare(nav: ShareNavigator, payload: SharePayload): Promise<ShareOutcome> {
  if (typeof nav.share !== 'function') return 'fallback';
  if (typeof nav.canShare === 'function' && !nav.canShare(payload)) return 'fallback';
  try {
    await nav.share(payload);
    return 'shared';
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    if (name === 'AbortError') return 'cancelled';
    return name === 'InvalidStateError' ? 'busy' : 'fallback';
  }
}

/** The ways `copyText` can write to the clipboard. */
export interface CopyEnv {
  /** `navigator.clipboard`, when the browser has it (secure contexts only). */
  readonly clipboard?: { writeText: (text: string) => Promise<void> } | undefined;
  /** The legacy path: select `text` in a temporary field and run `document.execCommand('copy')`. */
  readonly legacyCopy?: ((text: string) => boolean) | undefined;
}

/** Copies `text`: the async Clipboard API first, then the legacy path. Resolves to whether it worked. */
export async function copyText(env: CopyEnv, text: string): Promise<boolean> {
  if (env.clipboard !== undefined) {
    try {
      await env.clipboard.writeText(text);
      return true;
    } catch {
      // Permission denied or not focused: try the legacy path.
    }
  }
  try {
    return env.legacyCopy?.(text) ?? false;
  } catch {
    return false;
  }
}

/** Parses the `data-share` JSON a `<ShareButton>` renders; `null` when it is missing or malformed. */
export function parseShareConfig(json: string | undefined): ShareConfig | null {
  if (json === undefined) return null;
  try {
    const value = JSON.parse(json) as Partial<ShareConfig> | null;
    const payload = value?.payload;
    if (
      typeof value?.text !== 'string' ||
      typeof payload?.title !== 'string' ||
      typeof payload.text !== 'string' ||
      typeof payload.url !== 'string'
    )
      return null;
    return { payload: { title: payload.title, text: payload.text, url: payload.url }, text: value.text };
  } catch {
    return null;
  }
}
