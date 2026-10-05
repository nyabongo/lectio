/// Paths of the API v1 documents, relative to the API root (docs/api.md).
library;

final RegExp _isoDate = RegExp(r'^\d{4}-\d{2}-\d{2}$');

/// `index.json`.
const String indexPath = 'index.json';

/// `passages/index.json`.
const String passageIndexPath = 'passages/index.json';

/// `upcoming.json`.
const String upcomingPath = 'upcoming.json';

/// `days/{date}.json` for the ISO [date] (`2026-09-20`).
String dayPath(String date) {
  if (!_isoDate.hasMatch(date)) {
    throw ArgumentError.value(date, 'date', 'Expected an ISO date');
  }
  return 'days/$date.json';
}

/// `passages/{key}.json` for the canonical passage [key] (`MT.20.1-16`).
String passagePath(String key) => 'passages/${Uri.encodeComponent(key)}.json';

/// `calendar/{year}.json`.
String calendarPath(int year) => 'calendar/$year.json';

/// The locale of the documents at the API root.
const String defaultApiLocale = 'en';

/// Locales with a mirror of the documents under `<locale>/` (L-113).
const List<String> apiMirrorLocales = ['sw'];

/// The locale whose documents the app reads for the UI [language]: its
/// mirror when there is one, else [defaultApiLocale].
String apiLocaleFor(String? language) {
  return apiMirrorLocales.contains(language) ? language! : defaultApiLocale;
}

/// [path] in [locale]'s mirror: `sw/days/2026-09-20.json` for `sw`, the path
/// unchanged for [defaultApiLocale]. `index.json` has no mirror; it lists
/// the mirrors under `endpoints.locales`.
String localizedPath(String path, String locale) {
  if (locale == defaultApiLocale || path == indexPath) return path;
  return '$locale/$path';
}
