import 'package:lectio/data/json.dart';
import 'package:lectio/data/models/notes.dart';
import 'package:lectio/src/theme/liturgical_colour.dart';

/// A celebration on a liturgical day.
class Celebration {
  /// Creates a celebration.
  const new({
    required this.id,
    required this.name,
    required this.rank,
    required this.colour,
  });

  /// Reads a `celebrations` item.
  factory fromJson(Object? json) {
    final object = asJsonObject(json, 'celebrations');
    return Celebration(
      id: object.string('id'),
      name: object.string('name'),
      rank: object.string('rank'),
      colour: object.string('colour'),
    );
  }

  /// Stable id, for example `ordinary-time-25-sunday`.
  final String id;

  /// Display name.
  final String name;

  /// `solemnity`, `sunday`, `feast` … (open list).
  final String rank;

  /// Liturgical colour name.
  final String colour;
}

/// A reading in a day document, with its approved notes inline.
class DayReading {
  /// Creates a day reading.
  const new({
    required this.slot,
    required this.ref,
    required this.key,
    required this.linkout,
    this.passage,
  });

  /// Reads a `readings` item of `days/{date}.json`.
  factory fromJson(Object? json) {
    final object = asJsonObject(json, 'readings');
    final passage = object.optionalObject('passage');
    return DayReading(
      slot: object.string('slot'),
      ref: object.string('ref'),
      key: object.string('key'),
      linkout: object.uri('linkout'),
      passage: passage == null ? null : PassageNotes.fromJson(passage),
    );
  }

  /// `first-reading`, `psalm`, `gospel` … (open list).
  final String slot;

  /// Display reference.
  final String ref;

  /// Canonical passage key.
  final String key;

  /// The licensed text of the reading, which Lectio never stores.
  final Uri linkout;

  /// The approved notes, or `null` when there are none yet.
  final PassageNotes? passage;
}

/// A reading in a calendar or upcoming listing: no notes, only a summary.
class ReadingSummary {
  /// Creates a reading summary.
  const new({
    required this.slot,
    required this.ref,
    required this.key,
    required this.linkout,
    required this.hasNotes,
    this.summary,
  });

  /// Reads a `readings` item of a calendar or upcoming listing.
  factory fromJson(Object? json) {
    final object = asJsonObject(json, 'readings');
    return ReadingSummary(
      slot: object.string('slot'),
      ref: object.string('ref'),
      key: object.string('key'),
      linkout: object.uri('linkout'),
      hasNotes: object.boolean('hasNotes'),
      summary: object.optionalString('summary'),
    );
  }

  /// `first-reading`, `psalm`, `gospel` … (open list).
  final String slot;

  /// Display reference.
  final String ref;

  /// Canonical passage key.
  final String key;

  /// The licensed text of the reading, which Lectio never stores.
  final Uri linkout;

  /// Whether approved notes exist (`passages/{key}.json`).
  final bool hasNotes;

  /// One-line summary of the notes, or `null` without notes.
  final String? summary;
}

/// One Mass of a day and its readings ([R] is the reading shape).
class Mass<R> {
  /// Creates a Mass.
  const new({required this.id, required this.label, required this.readings});

  /// Reads a `masses` item, each reading read by [reading].
  factory fromJson(Object? json, R Function(Object? json) reading) {
    final object = asJsonObject(json, 'masses');
    return Mass(
      id: object.string('id'),
      label: object.string('label'),
      readings: object.list('readings', reading),
    );
  }

  /// Stable id, for example `day` or `vigil`.
  final String id;

  /// Display label.
  final String label;

  /// Readings in liturgical order.
  final List<R> readings;
}

/// A liturgical day ([R] is the reading shape).
///
/// The same header is used by `days/{date}.json` ([ApiDay], readings with
/// notes inline) and by calendar and upcoming listings ([DaySummary]).
class LiturgicalDay<R> {
  /// Creates a liturgical day.
  const new({
    required this.date,
    required this.season,
    required this.seasonWeek,
    required this.sundayCycle,
    required this.weekdayCycle,
    required this.colour,
    required this.celebrations,
    required this.lectionaryMissing,
    required this.masses,
  });

  /// Reads a day object, each reading read by [reading].
  factory fromJson(Object? json, R Function(Object? json) reading) {
    final object = asJsonObject(json, 'day');
    return LiturgicalDay(
      date: object.string('date'),
      season: object.string('season'),
      seasonWeek: object.integer('seasonWeek'),
      sundayCycle: object.string('sundayCycle'),
      weekdayCycle: object.string('weekdayCycle'),
      colour: object.string('colour'),
      celebrations: object.list('celebrations', Celebration.fromJson),
      lectionaryMissing: object.boolean('lectionaryMissing'),
      masses: object.list('masses', (mass) => Mass.fromJson(mass, reading)),
    );
  }

  /// ISO date, for example `2026-09-20`.
  final String date;

  /// Season id, for example `ordinary-time`.
  final String season;

  /// Week of the season.
  final int seasonWeek;

  /// Sunday lectionary cycle: `A`, `B` or `C`.
  final String sundayCycle;

  /// Weekday lectionary cycle: `I` or `II`.
  final String weekdayCycle;

  /// Colour name of the principal celebration.
  final String colour;

  /// Celebrations, the principal one first.
  final List<Celebration> celebrations;

  /// Whether the lectionary has no readings for this day yet.
  final bool lectionaryMissing;

  /// Masses, each with its readings.
  final List<Mass<R>> masses;

  /// [colour] as a theme colour (green when unknown).
  LiturgicalColour get liturgicalColour => parseLiturgicalColour(colour);

  /// Every reading of every Mass, in order.
  Iterable<R> get readings => masses.expand((mass) => mass.readings);
}

/// A day document, `days/{date}.json`.
typedef ApiDay = LiturgicalDay<DayReading>;

/// A day in `calendar/{year}.json` or `upcoming.json`.
typedef DaySummary = LiturgicalDay<ReadingSummary>;

/// Reads `days/{date}.json`.
ApiDay parseApiDay(Object? json) {
  return LiturgicalDay.fromJson(asApiDocument(json), DayReading.fromJson);
}

/// Reads a day of a calendar or upcoming listing.
DaySummary parseDaySummary(Object? json) {
  return LiturgicalDay.fromJson(json, ReadingSummary.fromJson);
}
