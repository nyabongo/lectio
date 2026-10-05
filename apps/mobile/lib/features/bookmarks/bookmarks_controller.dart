import 'dart:convert';

import 'package:flutter/widgets.dart';
import 'package:lectio/data/json.dart';
import 'package:lectio/features/bookmarks/bookmark.dart';
import 'package:lectio/features/settings/key_value_store.dart';

/// Bookmarks and personal notes, kept on the device in a [KeyValueStore].
///
/// There are no accounts, so nothing syncs: the only way out is
/// [exportJson], which the Bookmarks screen shares through the share sheet.
/// Screens that show a day, a reading or an insight (L-102, L-103) use
/// `BookmarkButton` and `showNoteEditor` from `bookmarks_screen.dart`.
///
/// Stored as versioned JSON under [storageKey]. Reading is tolerant: invalid
/// JSON reads as empty and a malformed entry is skipped, so one bad record
/// never loses the rest.
class BookmarksController extends ChangeNotifier {
  /// Creates a controller over [_store]; [clock] gives the time saved with
  /// each change (default: now).
  new(this._store, {DateTime Function()? clock})
    : _clock = clock ?? DateTime.now;

  /// The key bookmarks and notes are saved under.
  static const String storageKey = 'lectio.bookmarks';

  /// The shape version written with every save and export.
  static const int version = 1;

  final KeyValueStore _store;
  final DateTime Function() _clock;

  late final Map<BookmarkTarget, Bookmark> _bookmarks = {
    for (final bookmark in _stored('bookmarks', Bookmark.fromJson))
      bookmark.target: bookmark,
  };

  late final Map<BookmarkTarget, PersonalNote> _notes = {
    for (final note in _stored('notes', PersonalNote.fromJson))
      note.target: note,
  };

  late final JsonObject _saved = _decode(_store.read(storageKey));

  static JsonObject _decode(String? raw) {
    if (raw == null) return const {};
    try {
      final json = jsonDecode(raw);
      return json is JsonObject ? json : const {};
    } on FormatException {
      return const {};
    }
  }

  List<T> _stored<T>(String field, T Function(Object? json) parse) {
    final items = _saved[field];
    if (items is! List<Object?>) return const [];
    final parsed = <T>[];
    for (final item in items) {
      try {
        parsed.add(parse(item));
      } on FormatException {
        // A malformed entry is dropped; the others survive.
      }
    }
    return parsed;
  }

  /// Bookmarks, most recently saved first.
  List<Bookmark> get bookmarks {
    return _bookmarks.values.toList()
      ..sort((a, b) => b.savedAt.compareTo(a.savedAt));
  }

  /// Personal notes, most recently changed first.
  List<PersonalNote> get notes {
    return _notes.values.toList()
      ..sort((a, b) => b.updatedAt.compareTo(a.updatedAt));
  }

  /// Whether there is nothing to show or export.
  bool get isEmpty => _bookmarks.isEmpty && _notes.isEmpty;

  /// Whether [target] is bookmarked.
  bool isBookmarked(BookmarkTarget target) => _bookmarks.containsKey(target);

  /// The note on [target], or `null` when there is none.
  PersonalNote? noteFor(BookmarkTarget target) => _notes[target];

  /// Bookmarks [target] under [title], or removes its bookmark; completes
  /// with whether the change was saved.
  Future<bool> toggleBookmark(BookmarkTarget target, {required String title}) {
    if (_bookmarks.remove(target) == null) {
      _bookmarks[target] = Bookmark(
        target: target,
        title: title,
        savedAt: _clock(),
      );
    }
    return _changed();
  }

  /// Removes the bookmark of [target]; completes with whether it was saved.
  Future<bool> removeBookmark(BookmarkTarget target) {
    _bookmarks.remove(target);
    return _changed();
  }

  /// Saves [text] as the note on [target], titled [title]; blank text
  /// deletes the note. Completes with whether the change was saved.
  Future<bool> saveNote(
    BookmarkTarget target, {
    required String title,
    required String text,
  }) {
    final trimmed = text.trim();
    if (trimmed.isEmpty) return deleteNote(target);
    final now = _clock();
    _notes[target] = PersonalNote(
      target: target,
      title: title,
      text: trimmed,
      createdAt: _notes[target]?.createdAt ?? now,
      updatedAt: now,
    );
    return _changed();
  }

  /// Deletes the note on [target]; completes with whether it was saved.
  Future<bool> deleteNote(BookmarkTarget target) {
    _notes.remove(target);
    return _changed();
  }

  JsonObject _toJson() => {
    'version': version,
    'bookmarks': [for (final bookmark in bookmarks) bookmark.toJson()],
    'notes': [for (final note in notes) note.toJson()],
  };

  Future<bool> _changed() {
    notifyListeners();
    return _store.write(storageKey, jsonEncode(_toJson()));
  }

  /// Every bookmark and note as indented JSON, stamped with the export time,
  /// for the reader to keep or move to another device by hand.
  String exportJson() {
    final export = {
      'format': 'lectio-bookmarks',
      'exportedAt': _clock().toUtc().toIso8601String(),
      ..._toJson(),
    };
    return const JsonEncoder.withIndent('  ').convert(export);
  }
}

/// Makes a [BookmarksController] available below it, rebuilding dependants
/// when bookmarks or notes change.
class BookmarksScope extends InheritedNotifier<BookmarksController> {
  /// Provides [notifier] to [child].
  const new({
    required BookmarksController super.notifier,
    required super.child,
    super.key,
  });

  /// The controller of the nearest [BookmarksScope]; [context] rebuilds when
  /// bookmarks or notes change.
  static BookmarksController of(BuildContext context) {
    final scope = context.dependOnInheritedWidgetOfExactType<BookmarksScope>();
    assert(scope != null, 'No BookmarksScope above this context');
    return scope!.notifier!;
  }
}
