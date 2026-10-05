/// Links between the site and the app: the site URLs a share carries, and
/// the app location a site link (or a notification) opens.
library;

import 'package:lectio/data/api_client.dart';
import 'package:lectio/features/reading/reading_screen.dart';
import 'package:lectio/features/today/today_screen.dart';
import 'package:lectio/src/routing/app_route.dart';

/// The custom URL scheme the app answers to, for links such as
/// `lectio://2026-09-20/gospel/notes/v15-evil-eye`.
const String appLinkScheme = 'lectio';

/// The locale prefixes of the site's pages (`/sw/2026-09-20/`); English has
/// none. A link opens the same page whatever its locale.
const Set<String> siteLocales = {'sw'};

final RegExp _isoDate = RegExp(r'^\d{4}-\d{2}-\d{2}$');
final RegExp _slot = RegExp(r'^[a-z][a-z0-9-]*$');
final RegExp _noteId = RegExp(r'^[A-Za-z0-9_-]+$');

/// The site root of the API root [apiBaseUrl]: the API lives at
/// `<site>/api/v1/`, so `https://nyabongo.github.io/lectio/api/v1/` gives
/// `https://nyabongo.github.io/lectio/`.
Uri siteBaseFor(String apiBaseUrl) => Uri.parse(apiBaseUrl).resolve('../../');

/// The site this build links to, from `LECTIO_API_BASE_URL`
/// ([defaultApiBaseUrl]), so a build for another domain needs no other
/// setting.
final Uri siteBaseUrl = siteBaseFor(defaultApiBaseUrl);

/// The site path of a day, relative to the site root: `2026-09-20/`.
String dayPagePath(String date) => '$date/';

/// The site path of an insight: `2026-09-20/gospel/notes/v15-evil-eye/`.
String insightPagePath(String date, String slot, String noteId) {
  return '$date/$slot/notes/$noteId/';
}

/// The absolute URL of the site [path] (relative to the root), on [site]
/// (default: [siteBaseUrl]).
Uri siteUrl(String path, {Uri? site}) => (site ?? siteBaseUrl).resolve(path);

/// The Today location of the ISO [date]: `/today?date=2026-09-20`.
String dayLocation(String date) {
  return Uri(
    path: AppRoute.today.path,
    queryParameters: {'date': date},
  ).toString();
}

/// The Reading location of the note [noteId] on the reading in [slot] on
/// [date]: the reading's Original tab, with the note id in `note`.
String noteLocation(String date, String slot, String noteId) {
  final location = readingLocation(date, null, slot, tab: ReadingTab.original);
  final reading = Uri.parse(location);
  final query = {...reading.queryParameters, 'note': noteId};
  return reading.replace(queryParameters: query).toString();
}

/// The app location of a site page, from its path [segments] relative to
/// the site root (empty segments and a locale prefix are ignored), or
/// `null` when the app has no such page.
///
/// - `` → `/today`
/// - `2026-09-20` → `/today?date=2026-09-20`
/// - `2026-09-20/listen` → `/listen?date=2026-09-20`
/// - `2026-09-20/gospel` → `/reading?date=2026-09-20&slot=gospel`
/// - `2026-09-20/gospel/notes/v15-evil-eye` → that reading's Original tab
/// - `calendar/…` and `settings/…` → `/calendar` and `/settings`
String? locationForSitePath(List<String> segments) {
  final parts = segments.where((segment) => segment.isNotEmpty).toList();
  if (parts.isNotEmpty && siteLocales.contains(parts.first)) {
    parts.removeAt(0);
  }
  if (parts.isEmpty) return AppRoute.today.path;
  final date = parts.first;
  if (date == 'calendar') return AppRoute.calendar.path;
  if (date == 'settings') return AppRoute.settings.path;
  if (!_isoDate.hasMatch(date)) return null;
  return switch (parts.sublist(1)) {
    [] => dayLocation(date),
    ['listen'] => listenLocation(date),
    [final slot] when _slot.hasMatch(slot) => readingLocation(date, null, slot),
    [final slot, 'notes', final id] when _isNote(slot, id) => noteLocation(
      date,
      slot,
      id,
    ),
    _ => null,
  };
}

bool _isNote(String slot, String id) {
  return _slot.hasMatch(slot) && _noteId.hasMatch(id);
}

/// The app location [link] opens, or `null` when it is not a Lectio link.
///
/// A Lectio link is a page under [site] (default: [siteBaseUrl]; http or
/// https, same host and explicit port) or an [appLinkScheme] link, whose
/// host is the first path segment (`lectio://2026-09-20/gospel`, or
/// `lectio:///2026-09-20/gospel`). See [locationForSitePath].
String? locationForLink(Uri link, {Uri? site}) {
  if (link.scheme == appLinkScheme) {
    return locationForSitePath([link.host, ...link.pathSegments]);
  }
  final root = site ?? siteBaseUrl;
  if ((link.scheme != 'https' && link.scheme != 'http') ||
      link.host != root.host ||
      _port(link) != _port(root)) {
    return null;
  }
  final base = root.pathSegments.where((segment) => segment.isNotEmpty);
  final path = link.pathSegments;
  if (path.length < base.length) return null;
  for (final (index, segment) in base.indexed) {
    if (path[index] != segment) return null;
  }
  return locationForSitePath(path.sublist(base.length));
}

/// The port written in [uri], or `null` for the scheme's default.
int? _port(Uri uri) => uri.hasPort ? uri.port : null;

/// The location a daily-reminder tap opens: the Today tab of the ISO date
/// in its payload, or `null` when the payload is not a date.
String? reminderLocation(String? payload) {
  if (payload == null || !_isoDate.hasMatch(payload)) return null;
  return dayLocation(payload);
}
