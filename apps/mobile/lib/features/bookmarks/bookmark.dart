import 'package:flutter/foundation.dart';
import 'package:lectio/data/json.dart';

/// What a bookmark or personal note is about.
enum BookmarkKind {
  /// A liturgical day.
  day('Day'),

  /// One reading of a day.
  reading('Reading'),

  /// One insight (a translation note) on a reading.
  insight('Insight');

  new(this.label);

  /// The label shown in lists.
  final String label;
}

final RegExp _isoDate = RegExp(r'^\d{4}-\d{2}-\d{2}$');

/// The day, reading or insight a bookmark or note points at, the same three
/// levels the site links to.
///
/// A reading is a [slot] of a day (`gospel`); an insight is a translation note
/// id ([insight]) on that reading.
@immutable
class BookmarkTarget {
  /// Creates a target; give [slot] for a reading, and [insight] as well for
  /// an insight.
  const new({required this.date, this.slot, this.insight})
    : assert(insight == null || slot != null, 'An insight needs its slot');

  /// Reads a target written by [toJson].
  factory fromJson(Object? json) {
    final object = asJsonObject(json, 'target');
    final date = object.string('date');
    if (!_isoDate.hasMatch(date)) {
      throw FormatException('Expected an ISO date for "date": $date');
    }
    final slot = object.optionalString('slot');
    final insight = object.optionalString('insight');
    if (insight != null && slot == null) {
      throw const FormatException('An insight needs its "slot"');
    }
    return BookmarkTarget(date: date, slot: slot, insight: insight);
  }

  /// ISO date of the day, for example `2026-09-20`.
  final String date;

  /// The reading's slot, for example `gospel`, or `null` for the whole day.
  final String? slot;

  /// The translation note's id, or `null` for a whole day or reading.
  final String? insight;

  /// Whether this is a day, a reading or an insight.
  BookmarkKind get kind {
    if (insight != null) return BookmarkKind.insight;
    if (slot != null) return BookmarkKind.reading;
    return BookmarkKind.day;
  }

  /// A stable key, `date[/slot[/insight]]`, for example `2026-09-20/gospel`.
  String get key => [date, ?slot, ?insight].join('/');

  /// The target as JSON, for [BookmarkTarget.fromJson].
  JsonObject toJson() => {'date': date, 'slot': ?slot, 'insight': ?insight};

  @override
  bool operator ==(Object other) =>
      other is BookmarkTarget &&
      other.date == date &&
      other.slot == slot &&
      other.insight == insight;

  @override
  int get hashCode => Object.hash(date, slot, insight);

  @override
  String toString() => 'BookmarkTarget($key)';
}

/// A saved day, reading or insight.
class Bookmark {
  /// Creates a bookmark of [target], titled [title], saved at [savedAt].
  const new({required this.target, required this.title, required this.savedAt});

  /// Reads a bookmark written by [toJson].
  factory fromJson(Object? json) {
    final object = asJsonObject(json, 'bookmark');
    return Bookmark(
      target: BookmarkTarget.fromJson(object['target']),
      title: object.string('title'),
      savedAt: DateTime.parse(object.string('savedAt')),
    );
  }

  /// What is bookmarked.
  final BookmarkTarget target;

  /// What the list shows, for example `Gospel · Mt 20:1-16`.
  final String title;

  /// When it was saved.
  final DateTime savedAt;

  /// The bookmark as JSON, for [Bookmark.fromJson].
  JsonObject toJson() => {
    'target': target.toJson(),
    'title': title,
    'savedAt': savedAt.toUtc().toIso8601String(),
  };
}

/// A personal note on a day, reading or insight. One note per target.
class PersonalNote {
  /// Creates a note.
  const new({
    required this.target,
    required this.title,
    required this.text,
    required this.createdAt,
    required this.updatedAt,
  });

  /// Reads a note written by [toJson].
  factory fromJson(Object? json) {
    final object = asJsonObject(json, 'note');
    return PersonalNote(
      target: BookmarkTarget.fromJson(object['target']),
      title: object.string('title'),
      text: object.string('text'),
      createdAt: DateTime.parse(object.string('createdAt')),
      updatedAt: DateTime.parse(object.string('updatedAt')),
    );
  }

  /// What the note is about.
  final BookmarkTarget target;

  /// What the list shows, for example `Gospel · Mt 20:1-16`.
  final String title;

  /// The reader's own words.
  final String text;

  /// When the note was first written.
  final DateTime createdAt;

  /// When the note was last changed.
  final DateTime updatedAt;

  /// The note as JSON, for [PersonalNote.fromJson].
  JsonObject toJson() => {
    'target': target.toJson(),
    'title': title,
    'text': text,
    'createdAt': createdAt.toUtc().toIso8601String(),
    'updatedAt': updatedAt.toUtc().toIso8601String(),
  };
}
