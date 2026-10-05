import 'package:lectio/data/json.dart';
import 'package:lectio/data/models/day.dart';
import 'package:lectio/data/models/notes.dart';

/// The first and last date with a day document (`index.json` → `dates`).
///
/// Not a promise that every date in between exists: a missing day still
/// answers 404.
class DateRange {
  /// Creates a date range.
  const new({required this.first, required this.last});

  /// Reads a `dates` object.
  factory fromJson(Object? json) {
    final object = asJsonObject(json, 'dates');
    return DateRange(
      first: object.string('first'),
      last: object.string('last'),
    );
  }

  /// First ISO date.
  final String first;

  /// Last ISO date.
  final String last;

  /// Whether the ISO [date] lies between [first] and [last] inclusive.
  bool contains(String date) {
    return date.compareTo(first) >= 0 && date.compareTo(last) <= 0;
  }
}

/// `index.json`: the entry point of the API.
class ApiIndex {
  /// Creates an index.
  const new({
    required this.buildDate,
    required this.timezone,
    required this.defaultLocale,
    required this.locales,
    required this.apiRoot,
    required this.years,
    required this.passageCount,
    required this.endpoints,
    this.dates,
  });

  /// Reads `index.json`.
  factory fromJson(Object? json) {
    final object = asApiDocument(json);
    final dates = object.optionalObject('dates');
    final endpoints = object.object('endpoints');
    return ApiIndex(
      buildDate: object.string('buildDate'),
      timezone: object.string('timezone'),
      defaultLocale: object.string('defaultLocale'),
      locales: object.strings('locales'),
      apiRoot: object.uri('apiRoot'),
      years: object.integers('years'),
      dates: dates == null ? null : DateRange.fromJson(dates),
      passageCount: object.integer('passageCount'),
      endpoints: Map.unmodifiable({
        for (final MapEntry(:key, :value) in endpoints.entries)
          if (value is String) key: value,
      }),
    );
  }

  /// The date the build treated as today, in [timezone].
  final String buildDate;

  /// IANA time zone of the site's calendar.
  final String timezone;

  /// Default locale of the notes.
  final String defaultLocale;

  /// Locales with notes.
  final List<String> locales;

  /// Absolute URL of the API root.
  final Uri apiRoot;

  /// Years with a calendar document, ascending.
  final List<int> years;

  /// First and last date with a day document, or `null` when none exists.
  final DateRange? dates;

  /// How many passages have approved notes.
  final int passageCount;

  /// Endpoint templates by name, relative to [apiRoot]. Members that are not
  /// strings (a possible future addition) are left out.
  final Map<String, String> endpoints;
}

/// `passages/{key}.json`: the notes of one passage and the dates it is read.
class ApiPassage {
  /// Creates a passage document.
  const new({required this.passage, required this.dates});

  /// Reads `passages/{key}.json`.
  factory fromJson(Object? json) {
    final object = asApiDocument(json);
    return ApiPassage(
      passage: PassageNotes.fromJson(object.object('passage')),
      dates: object.strings('dates'),
    );
  }

  /// The approved notes.
  final PassageNotes passage;

  /// ISO dates the passage is read on, ascending.
  final List<String> dates;
}

/// An entry of `passages/index.json`.
class PassageIndexEntry {
  /// Creates a passage index entry.
  const new({
    required this.key,
    required this.ref,
    required this.summary,
    required this.dates,
    this.lastReviewedAt,
  });

  /// Reads a `passages` item.
  factory fromJson(Object? json) {
    final object = asJsonObject(json, 'passages');
    return PassageIndexEntry(
      key: object.string('key'),
      ref: object.string('ref'),
      summary: object.string('summary'),
      lastReviewedAt: object.optionalDateTime('lastReviewedAt'),
      dates: object.strings('dates'),
    );
  }

  /// Canonical passage key.
  final String key;

  /// Display reference.
  final String ref;

  /// One-line summary.
  final String summary;

  /// When the notes were last reviewed, or `null` if unknown.
  final DateTime? lastReviewedAt;

  /// ISO dates the passage is read on.
  final List<String> dates;
}

/// `passages/index.json`: every passage with approved notes, by key.
class PassageIndex {
  /// Creates a passage index.
  const new({required this.passages});

  /// Reads `passages/index.json`.
  factory fromJson(Object? json) {
    final object = asApiDocument(json);
    return PassageIndex(
      passages: object.list('passages', PassageIndexEntry.fromJson),
    );
  }

  /// Entries, sorted by key.
  final List<PassageIndexEntry> passages;
}

/// `calendar/{year}.json`: every day of a civil year, without notes.
class ApiCalendar {
  /// Creates a calendar year.
  const new({required this.year, required this.region, required this.days});

  /// Reads `calendar/{year}.json`.
  factory fromJson(Object? json) {
    final object = asApiDocument(json);
    return ApiCalendar(
      year: object.integer('year'),
      region: object.string('region'),
      days: object.list('days', parseDaySummary),
    );
  }

  /// The civil year.
  final int year;

  /// Calendar region, for example `kenya`.
  final String region;

  /// Every day of the year, in order.
  final List<DaySummary> days;
}

/// `upcoming.json`: the build date and the days after it.
class ApiUpcoming {
  /// Creates an upcoming listing.
  const new({
    required this.timezone,
    required this.from,
    required this.to,
    required this.days,
  });

  /// Reads `upcoming.json`.
  factory fromJson(Object? json) {
    final object = asApiDocument(json);
    return ApiUpcoming(
      timezone: object.string('timezone'),
      from: object.string('from'),
      to: object.string('to'),
      days: object.list('days', parseDaySummary),
    );
  }

  /// IANA time zone of the dates.
  final String timezone;

  /// The build date (first date of the window).
  final String from;

  /// The last date of the window.
  final String to;

  /// Days in the window the calendar has.
  final List<DaySummary> days;
}
