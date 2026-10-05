import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:lectio/features/bookmarks/bookmark.dart';
import 'package:lectio/features/bookmarks/bookmark_export.dart';
import 'package:lectio/features/bookmarks/bookmarks_controller.dart';
import 'package:lectio/features/bookmarks/bookmarks_screen.dart';
import 'package:lectio/features/settings/key_value_store.dart';
import 'package:lectio/src/app.dart';
import 'package:share_plus/share_plus.dart';

const day = BookmarkTarget(date: '2026-09-20');
const gospel = BookmarkTarget(date: '2026-09-20', slot: 'gospel');
const insight = BookmarkTarget(
  date: '2026-09-20',
  slot: 'gospel',
  insight: 'tn-1',
);

/// Shows the Bookmarks screen for [controller], sharing through [share].
Future<void> pumpBookmarks(
  WidgetTester tester,
  BookmarksController controller, {
  ShareSheet? share,
}) async {
  final router = GoRouter(
    initialLocation: '/bookmarks',
    routes: [
      GoRoute(
        path: '/bookmarks',
        builder: (context, state) => BookmarksScreen(share: share),
      ),
    ],
  );
  addTearDown(router.dispose);
  await tester.pumpWidget(
    BookmarksScope(
      notifier: controller,
      child: MaterialApp.router(routerConfig: router),
    ),
  );
  await tester.pumpAndSettle();
}

/// Shows [child] in a page under a scope for [controller].
Future<void> pumpInPage(
  WidgetTester tester,
  BookmarksController controller,
  Widget child,
) async {
  await tester.pumpWidget(
    BookmarksScope(
      notifier: controller,
      child: MaterialApp(
        home: Scaffold(body: Center(child: child)),
      ),
    ),
  );
}

void main() {
  late MemoryKeyValueStore store;
  late BookmarksController controller;

  setUp(() {
    store = MemoryKeyValueStore();
    controller = BookmarksController(
      store,
      clock: () => DateTime.utc(2026, 9, 20, 7),
    );
  });

  group('BookmarksScreen', () {
    testWidgets('says when there is nothing saved', (tester) async {
      await pumpBookmarks(tester, controller);

      expect(find.text(bookmarksTitle), findsOneWidget);
      expect(find.text('No bookmarks yet.'), findsOneWidget);
      expect(find.text('No notes yet.'), findsOneWidget);
      final export = tester.widget<ButtonStyleButton>(
        find.ancestor(
          of: find.text('Export as JSON'),
          matching: find.bySubtype<ButtonStyleButton>(),
        ),
      );
      expect(export.onPressed, isNull);
    });

    testWidgets('lists bookmarks and notes', (tester) async {
      await controller.toggleBookmark(day, title: 'Sunday');
      await controller.toggleBookmark(gospel, title: 'Gospel · Mt 20:1-16');
      await controller.saveNote(insight, title: 'denarius', text: 'A wage.');
      await pumpBookmarks(tester, controller);

      expect(find.text('Sunday'), findsOneWidget);
      expect(find.text('Day · 2026-09-20'), findsOneWidget);
      expect(find.text('Gospel · Mt 20:1-16'), findsOneWidget);
      expect(find.text('Reading · 2026-09-20'), findsOneWidget);
      expect(find.text('denarius'), findsOneWidget);
      expect(find.text('A wage.'), findsOneWidget);
      expect(find.byIcon(Icons.lightbulb_outline), findsOneWidget);
      expect(find.byIcon(Icons.menu_book_outlined), findsOneWidget);
      expect(find.byIcon(Icons.today_outlined), findsWidgets);
    });

    testWidgets('removes a bookmark', (tester) async {
      await controller.toggleBookmark(day, title: 'Sunday');
      await pumpBookmarks(tester, controller);

      await tester.tap(find.byTooltip('Remove bookmark'));
      await tester.pumpAndSettle();

      expect(find.text('Sunday'), findsNothing);
      expect(find.text('No bookmarks yet.'), findsOneWidget);
      expect(BookmarksController(store).bookmarks, isEmpty);
    });

    testWidgets('deletes a note', (tester) async {
      await controller.saveNote(day, title: 'Sunday', text: 'a');
      await pumpBookmarks(tester, controller);

      await tester.tap(find.byTooltip('Delete note'));
      await tester.pumpAndSettle();

      expect(find.text('No notes yet.'), findsOneWidget);
      expect(BookmarksController(store).notes, isEmpty);
      expect(find.text('Note deleted.'), findsOneWidget);
    });

    testWidgets('undoes deleting a note', (tester) async {
      await controller.saveNote(day, title: 'Sunday', text: 'mine');
      await pumpBookmarks(tester, controller);

      await tester.tap(find.byTooltip('Delete note'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Undo'));
      await tester.pumpAndSettle();

      expect(find.text('mine'), findsOneWidget);
      expect(BookmarksController(store).noteFor(day)!.text, 'mine');
    });

    testWidgets('says when deleting a note is not saved', (tester) async {
      await controller.saveNote(day, title: 'Sunday', text: 'a');
      store.failWrites = true;
      await pumpBookmarks(tester, controller);

      await tester.tap(find.byTooltip('Delete note'));
      await tester.pumpAndSettle();

      expect(find.textContaining('not letting Lectio save'), findsOneWidget);
      expect(find.text('Undo'), findsNothing);
    });

    testWidgets('says when saved data could not be read', (tester) async {
      store = MemoryKeyValueStore({
        BookmarksController.storageKey: 'not json',
      });
      final shared = <ShareParams>[];
      await pumpBookmarks(
        tester,
        BookmarksController(store),
        share: (params) async {
          shared.add(params);
          return const ShareResult('done', ShareResultStatus.success);
        },
      );

      expect(find.textContaining('could not be read'), findsOneWidget);
      await tester.tap(find.text('Export as JSON'));
      await tester.pumpAndSettle();
      expect(shared, hasLength(1));
    });

    testWidgets('edits a note', (tester) async {
      await controller.saveNote(day, title: 'Sunday', text: 'old');
      await pumpBookmarks(tester, controller);

      await tester.tap(find.text('old'));
      await tester.pumpAndSettle();
      expect(find.text('Edit note'), findsOneWidget);

      await tester.enterText(find.byType(TextField), 'new');
      await tester.tap(find.text('Save'));
      await tester.pumpAndSettle();

      expect(find.text('new'), findsOneWidget);
      expect(BookmarksController(store).noteFor(day)!.text, 'new');
    });

    testWidgets('exports through the share sheet', (tester) async {
      await controller.toggleBookmark(day, title: 'Sunday');
      final shared = <ShareParams>[];
      await pumpBookmarks(
        tester,
        controller,
        share: (params) async {
          shared.add(params);
          return const ShareResult('done', ShareResultStatus.success);
        },
      );

      await tester.tap(find.text('Export as JSON'));
      await tester.pumpAndSettle();

      final params = shared.single;
      expect(params.fileNameOverrides, [exportFileName]);
      expect(params.sharePositionOrigin, isNotNull);
      final bytes = await params.files!.single.readAsBytes();
      final json = jsonDecode(utf8.decode(bytes)) as Map<String, Object?>;
      expect(json['bookmarks'], [controller.bookmarks.single.toJson()]);
    });

    testWidgets('says when the share sheet fails', (tester) async {
      await controller.saveNote(day, title: 'Sunday', text: 'a');
      await pumpBookmarks(
        tester,
        controller,
        share: (params) async => throw PlatformException(code: 'busy'),
      );

      await tester.tap(find.text('Export as JSON'));
      await tester.pumpAndSettle();

      expect(find.text('The share sheet could not be opened.'), findsOneWidget);
    });

    testWidgets('says when a change is not saved', (tester) async {
      await controller.toggleBookmark(day, title: 'Sunday');
      store.failWrites = true;
      await pumpBookmarks(tester, controller);

      await tester.tap(find.byTooltip('Remove bookmark'));
      await tester.pumpAndSettle();

      expect(find.textContaining('not letting Lectio save'), findsOneWidget);
    });

    testWidgets('opens from Settings at /settings/bookmarks', (tester) async {
      await controller.toggleBookmark(day, title: 'Sunday');
      await tester.pumpWidget(
        LectioApp(
          initialLocation: '/settings/bookmarks',
          bookmarks: controller,
        ),
      );
      await tester.pumpAndSettle();

      expect(find.byType(BookmarksScreen), findsOneWidget);
      expect(find.text('Sunday'), findsOneWidget);
    });
  });

  group('BookmarkButton', () {
    testWidgets('toggles the bookmark', (tester) async {
      // A target read back from JSON, as a screen gets it from the API.
      final target = BookmarkTarget.fromJson(gospel.toJson());
      await pumpInPage(
        tester,
        controller,
        BookmarkButton(target: target, title: 'Gospel'),
      );
      expect(find.byIcon(Icons.bookmark_border), findsOneWidget);

      await tester.tap(find.byTooltip('Bookmark'));
      await tester.pumpAndSettle();
      expect(controller.isBookmarked(gospel), isTrue);
      expect(controller.bookmarks.single.title, 'Gospel');
      expect(find.byIcon(Icons.bookmark), findsOneWidget);

      await tester.tap(find.byTooltip('Remove bookmark'));
      await tester.pumpAndSettle();
      expect(controller.isBookmarked(gospel), isFalse);
    });
  });

  group('showNoteEditor', () {
    Widget opener() => Builder(
      builder: (context) => TextButton(
        onPressed: () => showNoteEditor(context, insight, title: 'denarius'),
        child: const Text('Note'),
      ),
    );

    testWidgets('adds a note', (tester) async {
      await pumpInPage(tester, controller, opener());

      await tester.tap(find.text('Note'));
      await tester.pumpAndSettle();
      expect(find.text('Add a note'), findsOneWidget);
      expect(find.text('Delete'), findsNothing);

      await tester.enterText(find.byType(TextField), 'A day’s wage.');
      await tester.tap(find.text('Save'));
      await tester.pumpAndSettle();

      final note = controller.noteFor(insight)!;
      expect(note.text, 'A day’s wage.');
      expect(note.title, 'denarius');
    });

    testWidgets('cancel changes nothing', (tester) async {
      await controller.saveNote(insight, title: 'denarius', text: 'kept');
      await pumpInPage(tester, controller, opener());

      await tester.tap(find.text('Note'));
      await tester.pumpAndSettle();
      expect(find.text('kept'), findsOneWidget);

      await tester.enterText(find.byType(TextField), 'changed');
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();

      expect(controller.noteFor(insight)!.text, 'kept');
    });

    testWidgets('delete removes the note', (tester) async {
      await controller.saveNote(insight, title: 'denarius', text: 'gone');
      await pumpInPage(tester, controller, opener());

      await tester.tap(find.text('Note'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Delete'));
      await tester.pumpAndSettle();

      expect(controller.noteFor(insight), isNull);
      await tester.tap(find.text('Undo'));
      await tester.pumpAndSettle();
      expect(controller.noteFor(insight)!.text, 'gone');
    });

    testWidgets('saving a blank new note changes nothing', (tester) async {
      await pumpInPage(tester, controller, opener());

      await tester.tap(find.text('Note'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Save'));
      await tester.pumpAndSettle();

      expect(controller.noteFor(insight), isNull);
      expect(find.text('Undo'), findsNothing);
    });
  });
}
