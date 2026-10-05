import 'dart:convert';

import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lectio/features/bookmarks/bookmark.dart';
import 'package:lectio/features/bookmarks/bookmarks_controller.dart';
import 'package:lectio/features/settings/key_value_store.dart';

void main() {
  const day = BookmarkTarget(date: '2026-09-20');
  const gospel = BookmarkTarget(date: '2026-09-20', slot: 'gospel');
  const insight = BookmarkTarget(
    date: '2026-09-20',
    slot: 'gospel',
    insight: 'tn-1',
  );

  late MemoryKeyValueStore store;
  late DateTime now;

  BookmarksController controllerOn(MemoryKeyValueStore store) {
    return BookmarksController(store, clock: () => now);
  }

  setUp(() {
    store = MemoryKeyValueStore();
    now = DateTime.utc(2026, 9, 20, 7);
  });

  group('bookmarks', () {
    test('start empty', () {
      final controller = controllerOn(store);
      expect(controller.bookmarks, isEmpty);
      expect(controller.notes, isEmpty);
      expect(controller.isEmpty, isTrue);
      expect(controller.isBookmarked(day), isFalse);
    });

    test('toggle on and off, saving each change', () async {
      final controller = controllerOn(store);
      var notified = 0;
      controller.addListener(() => notified++);

      expect(await controller.toggleBookmark(day, title: 'Sunday'), isTrue);
      expect(controller.isBookmarked(day), isTrue);
      expect(controller.isEmpty, isFalse);
      expect(controller.bookmarks.single.title, 'Sunday');
      expect(controller.bookmarks.single.savedAt, now);
      expect(controllerOn(store).isBookmarked(day), isTrue);

      expect(await controller.toggleBookmark(day, title: 'Sunday'), isTrue);
      expect(controller.isBookmarked(day), isFalse);
      expect(controllerOn(store).bookmarks, isEmpty);
      expect(notified, 2);
    });

    test('list the most recently saved first', () async {
      final controller = controllerOn(store);
      await controller.toggleBookmark(day, title: 'Sunday');
      now = now.add(const Duration(minutes: 1));
      await controller.toggleBookmark(insight, title: 'denarius');
      now = now.add(const Duration(minutes: 1));
      await controller.toggleBookmark(gospel, title: 'Gospel');

      expect([for (final b in controller.bookmarks) b.target], [
        gospel,
        insight,
        day,
      ]);
      expect([for (final b in controllerOn(store).bookmarks) b.target], [
        gospel,
        insight,
        day,
      ]);
    });

    test('remove one', () async {
      final controller = controllerOn(store);
      await controller.toggleBookmark(day, title: 'Sunday');
      await controller.toggleBookmark(gospel, title: 'Gospel');

      expect(await controller.removeBookmark(day), isTrue);
      expect(controller.bookmarks.single.target, gospel);
      expect(controllerOn(store).bookmarks.single.target, gospel);
    });
  });

  group('notes', () {
    test('save, update and keep when first written', () async {
      final controller = controllerOn(store);
      expect(
        await controller.saveNote(gospel, title: 'Gospel', text: ' First '),
        isTrue,
      );
      final first = controller.noteFor(gospel)!;
      expect(first.text, 'First');
      expect(first.createdAt, now);

      final created = now;
      now = now.add(const Duration(hours: 1));
      await controller.saveNote(gospel, title: 'Gospel', text: 'Second');
      final second = controllerOn(store).noteFor(gospel)!;
      expect(second.text, 'Second');
      expect(second.title, 'Gospel');
      expect(second.createdAt, created);
      expect(second.updatedAt, now);
    });

    test('list the most recently changed first', () async {
      final controller = controllerOn(store);
      await controller.saveNote(day, title: 'Sunday', text: 'a');
      now = now.add(const Duration(minutes: 1));
      await controller.saveNote(gospel, title: 'Gospel', text: 'b');
      now = now.add(const Duration(minutes: 1));
      await controller.saveNote(day, title: 'Sunday', text: 'c');

      expect([for (final n in controller.notes) n.text], ['c', 'b']);
    });

    test('blank text deletes the note', () async {
      final controller = controllerOn(store);
      await controller.saveNote(day, title: 'Sunday', text: 'a');

      expect(await controller.saveNote(day, title: 'Sunday', text: '  '), isTrue);
      expect(controller.noteFor(day), isNull);
      expect(controllerOn(store).notes, isEmpty);
    });

    test('delete', () async {
      final controller = controllerOn(store);
      await controller.saveNote(day, title: 'Sunday', text: 'a');
      await controller.saveNote(insight, title: 'denarius', text: 'b');

      expect(await controller.deleteNote(day), isTrue);
      expect(controllerOn(store).notes.single.target, insight);
    });
  });

  group('storage', () {
    test('is versioned JSON', () async {
      final controller = controllerOn(store);
      await controller.toggleBookmark(day, title: 'Sunday');
      await controller.saveNote(day, title: 'Sunday', text: 'a');

      final json = jsonDecode(store.read(BookmarksController.storageKey)!);
      expect(json, {
        'version': 1,
        'bookmarks': [
          {
            'target': {'date': '2026-09-20'},
            'title': 'Sunday',
            'savedAt': '2026-09-20T07:00:00.000Z',
          },
        ],
        'notes': [
          {
            'target': {'date': '2026-09-20'},
            'title': 'Sunday',
            'text': 'a',
            'createdAt': '2026-09-20T07:00:00.000Z',
            'updatedAt': '2026-09-20T07:00:00.000Z',
          },
        ],
      });
    });

    test('reads anything unreadable as empty', () {
      for (final raw in ['not json', '[]', '{"bookmarks": {}, "notes": 3}']) {
        final broken = MemoryKeyValueStore({BookmarksController.storageKey: raw});
        expect(controllerOn(broken).isEmpty, isTrue, reason: raw);
      }
    });

    test('skips malformed entries and keeps the rest', () {
      final raw = jsonEncode({
        'version': 1,
        'bookmarks': [
          {'target': gospel.toJson(), 'title': 'Gospel', 'savedAt': 'soon'},
          {
            'target': day.toJson(),
            'title': 'Sunday',
            'savedAt': '2026-09-20T07:00:00.000Z',
          },
          'junk',
        ],
        'notes': [
          {'target': insight.toJson(), 'title': 'denarius'},
          {
            'target': insight.toJson(),
            'title': 'denarius',
            'text': 'A wage.',
            'createdAt': '2026-09-20T07:00:00.000Z',
            'updatedAt': '2026-09-20T07:00:00.000Z',
          },
        ],
      });
      final controller = controllerOn(
        MemoryKeyValueStore({BookmarksController.storageKey: raw}),
      );
      expect(controller.bookmarks.single.target, day);
      expect(controller.noteFor(insight)!.text, 'A wage.');
    });

    test('reports a change it could not save, and keeps it', () async {
      store.failWrites = true;
      final controller = controllerOn(store);

      expect(await controller.toggleBookmark(day, title: 'Sunday'), isFalse);
      expect(controller.isBookmarked(day), isTrue);
      expect(store.values, isEmpty);
    });

    test('uses the device clock by default', () async {
      final controller = BookmarksController(store);
      final before = DateTime.now();
      await controller.toggleBookmark(day, title: 'Sunday');
      final savedAt = controller.bookmarks.single.savedAt;
      expect(savedAt.isBefore(before), isFalse);
    });
  });

  test('exports everything as indented JSON', () async {
    final controller = controllerOn(store);
    await controller.toggleBookmark(gospel, title: 'Gospel');
    await controller.saveNote(insight, title: 'denarius', text: 'A wage.');
    now = DateTime.utc(2026, 10, 1, 12);

    final text = controller.exportJson();
    expect(text, contains('\n  "format": "lectio-bookmarks"'));
    final json = jsonDecode(text) as Map<String, Object?>;
    expect(json['format'], 'lectio-bookmarks');
    expect(json['version'], 1);
    expect(json['exportedAt'], '2026-10-01T12:00:00.000Z');
    expect(json['bookmarks'], [controller.bookmarks.single.toJson()]);
    expect(json['notes'], [controller.notes.single.toJson()]);
  });

  testWidgets('BookmarksScope provides the controller', (tester) async {
    final controller = controllerOn(store);
    late BookmarksController found;
    var builds = 0;
    await tester.pumpWidget(
      BookmarksScope(
        notifier: controller,
        child: Builder(
          builder: (context) {
            found = BookmarksScope.of(context);
            builds++;
            return const SizedBox();
          },
        ),
      ),
    );
    expect(found, same(controller));

    await controller.toggleBookmark(day, title: 'Sunday');
    await tester.pump();
    expect(builds, 2);
  });

  testWidgets('BookmarksScope.of needs a scope above', (tester) async {
    late BuildContext captured;
    await tester.pumpWidget(
      Builder(
        builder: (context) {
          captured = context;
          return const SizedBox();
        },
      ),
    );
    expect(() => BookmarksScope.of(captured), throwsAssertionError);
  });
}
