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
/// never hides the rest. These are the reader's own words, so nothing that
/// could not be read is ever overwritten without a copy: see
/// [hasUnreadableData].
class BookmarksController extends ChangeNotifier {
  /// Creates a controller over [_store]; [clock] gives the time saved with
  /// each change (default: now).
  new(this._store, {DateTime Function()? clock})
    : _clock = clock ?? DateTime.now;

  /// The key bookmarks and notes are saved under.
  static const String storageKey = 'lectio.bookmarks';

  /// Where saved text that could not be read is kept before an overwrite.
  static const String unreadableKey = 'lectio.bookmarks.unreadable';

  /// The shape version written with every save and export. A blob with
  /// another version is not parsed (it may come from a newer app); it is
  /// kept as unreadable instead.
  static const int version = 1;

  final KeyValueStore _store;
  final DateTime Function() _clock;

  late final _Saved _saved = _Saved.read(_store.read(storageKey));

  late final Map<BookmarkTarget, Bookmark> _bookmarks = _saved.bookmarks;

  late final Map<BookmarkTarget, PersonalNote> _notes = _saved.notes;

  bool _backedUp = false;

  /// Whether some of the saved data could not be read: malformed JSON or
  /// entries, or a shape from a newer version of the app.
  ///
  /// The unreadable text is never lost: it is copied under [unreadableKey]
  /// before the first change overwrites it, and [exportJson] includes it.
  bool get hasUnreadableData => _saved.unreadable != null;

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

  /// Puts back [note] as it was, for example to undo a delete; completes
  /// with whether it was saved.
  Future<bool> restoreNote(PersonalNote note) {
    _notes[note.target] = note;
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

  Future<bool> _changed() async {
    notifyListeners();
    final unreadable = _saved.unreadable;
    if (unreadable != null && !_backedUp) {
      // Refuse to overwrite what could not be read until a copy is kept.
      if (!await writeSafely(_store, unreadableKey, unreadable)) return false;
      _backedUp = true;
    }
    return writeSafely(_store, storageKey, jsonEncode(_toJson()));
  }

  /// Every bookmark and note as indented JSON, stamped with the export time,
  /// for the reader to keep or move to another device by hand.
  String exportJson() {
    final export = {
      'format': 'lectio-bookmarks',
      'exportedAt': _clock().toUtc().toIso8601String(),
      ..._toJson(),
      'unreadable': ?_saved.unreadable,
    };
    return const JsonEncoder.withIndent('  ').convert(export);
  }
}

/// What was saved: the entries that could be read, and the raw text when
/// some of it could not.
class _Saved {
  new({required this.bookmarks, required this.notes, this.unreadable});

  factory read(String? raw) {
    final bookmarks = <BookmarkTarget, Bookmark>{};
    final notes = <BookmarkTarget, PersonalNote>{};
    if (raw == null) return _Saved(bookmarks: bookmarks, notes: notes);
    final json = _decode(raw);
    if (json == null || json['version'] != BookmarksController.version) {
      return _Saved(bookmarks: bookmarks, notes: notes, unreadable: raw);
    }
    final bookmarksRead = _parse(json['bookmarks'], Bookmark.fromJson, (
      bookmark,
    ) {
      bookmarks[bookmark.target] = bookmark;
    });
    final notesRead = _parse(json['notes'], PersonalNote.fromJson, (note) {
      notes[note.target] = note;
    });
    final complete = bookmarksRead && notesRead;
    return _Saved(
      bookmarks: bookmarks,
      notes: notes,
      unreadable: complete ? null : raw,
    );
  }

  final Map<BookmarkTarget, Bookmark> bookmarks;
  final Map<BookmarkTarget, PersonalNote> notes;

  /// The saved text, when some of it could not be read.
  final String? unreadable;

  static JsonObject? _decode(String raw) {
    try {
      final json = jsonDecode(raw);
      return json is JsonObject ? json : null;
    } on FormatException {
      return null;
    }
  }

  /// Parses each item of [items] and hands it to [add]; whether every item
  /// could be read.
  static bool _parse<T>(
    Object? items,
    T Function(Object? json) parse,
    void Function(T item) add,
  ) {
    if (items is! List<Object?>) return false;
    var complete = true;
    for (final item in items) {
      try {
        add(parse(item));
      } on FormatException {
        complete = false;
      }
    }
    return complete;
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
