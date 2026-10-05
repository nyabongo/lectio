/// The text people pass along when they share a day, a reading or one
/// insight: the reference, a one-line insight and the link, one per line.
///
/// The same rules as the site's `buildShareText` (apps/web/src/lib/share.ts),
/// pinned by the test vectors in packages/schema/fixtures/share-text.json.
/// Lengths count Unicode code points (runes), never UTF-16 units; links never
/// carry a query string, so no tracking parameters travel with them.
library;

/// Longest reference line, ellipsis included, in code points.
const int refMaxLength = 100;

/// Longest insight line, ellipsis included, in code points.
const int insightMaxLength = 160;

const String _ellipsis = '…';

/// The whitespace the share text collapses: U+0020 SPACE and U+0009–U+000D
/// (tab, line feed, vertical tab, form feed, carriage return) only. Other
/// spaces (NBSP, U+2009, U+FEFF…) are kept as they are, so every platform
/// agrees.
final RegExp _whitespaceRun = RegExp(r'[\t\n\x0B\f\r ]+');

/// What [truncate] drops before the ellipsis.
final RegExp _trailingPunctuation = RegExp(r'[ ,;:.–—-]+$');

/// [text] on one line: each run of whitespace (see [_whitespaceRun]) becomes
/// one space, and the ends are trimmed of U+0020.
String oneLine(String text) {
  var line = text.replaceAll(_whitespaceRun, ' ');
  if (line.startsWith(' ')) line = line.substring(1);
  if (line.endsWith(' ')) line = line.substring(0, line.length - 1);
  return line;
}

/// [text] (already on one line) cut to at most [max] code points, ellipsis
/// included.
///
/// The room is the first `max - 1` code points; the cut is at the last
/// U+0020 in the room when its index is at least half the room's length
/// (rounded down), else at the end of the room (mid-word). Trailing spaces
/// and `,;:.–—-` before the ellipsis are dropped.
String truncate(String text, int max) {
  final chars = text.runes.toList();
  if (chars.length <= max) return text;
  final room = chars.sublist(0, max - 1);
  final space = room.lastIndexOf(0x20);
  final cut = space >= room.length ~/ 2 ? room.sublist(0, space) : room;
  final kept = String.fromCharCodes(cut);
  return '${kept.replaceFirst(_trailingPunctuation, '')}$_ellipsis';
}

/// The link to share: [url] without its query string, so no analytics or
/// tracking parameters ever travel with it; the path and fragment stay.
///
/// Throws an [ArgumentError] for anything but an absolute http(s) URL.
String cleanShareUrl(String url) {
  final parsed = Uri.tryParse(url);
  if (parsed == null ||
      (parsed.scheme != 'https' && parsed.scheme != 'http') ||
      parsed.host.isEmpty) {
    throw ArgumentError.value(url, 'url', 'Expected an absolute http(s) URL');
  }
  final href = parsed.toString();
  final hash = href.indexOf('#');
  final fragment = hash < 0 ? '' : href.substring(hash);
  var rest = hash < 0 ? href : href.substring(0, hash);
  final query = rest.indexOf('?');
  if (query >= 0) rest = rest.substring(0, query);
  // As a browser writes it: an empty path is `/`.
  if (parsed.path.isEmpty) rest = '$rest/';
  return '$rest$fragment';
}

/// The reference and insight lines, each on one line and within its limit;
/// an empty insight is left out.
///
/// Throws an [ArgumentError] when the reference is empty.
List<String> shareLines({required String ref, String? insight}) {
  final refLine = truncate(oneLine(ref), refMaxLength);
  if (refLine.isEmpty) {
    throw ArgumentError.value(ref, 'ref', 'A share needs a reference');
  }
  final insightLine = truncate(oneLine(insight ?? ''), insightMaxLength);
  return [refLine, if (insightLine.isNotEmpty) insightLine];
}

/// The share text: the reference, the insight (when there is one) and the
/// link, one per line.
String buildShareText({
  required String ref,
  required String? insight,
  required String url,
}) {
  return [
    ...shareLines(ref: ref, insight: insight),
    cleanShareUrl(url),
  ].join('\n');
}
