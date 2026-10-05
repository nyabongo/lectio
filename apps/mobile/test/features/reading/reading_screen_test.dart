import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:lectio/data/api_cache.dart';
import 'package:lectio/features/reading/reading_screen.dart';
import 'package:lectio/features/reading/reading_scope.dart';

import '../../data/fixtures.dart';
import 'reading_harness.dart';

/// The tooltip of the seed Gospel's Text link-out.
const String linkoutLabel =
    'Read the text of Mt 20:1-16a at drbo.org (opens outside the app)';

/// Makes the test screen tall enough to build whole tab panels.
void useTallScreen(WidgetTester tester) {
  tester.view.physicalSize = const Size(800, 2400);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
}

/// Pumps [screen] (default: the seed day) and waits for the data.
Future<void> pumpReading(
  WidgetTester tester,
  ReadingHarness harness, {
  ReadingScreen screen = const ReadingScreen(date: seedDate),
}) async {
  useTallScreen(tester);
  await tester.pumpWidget(harness.wrap(screen));
  await tester.pumpAndSettle();
}

/// The direction the nearest [Directionality] gives the text [text].
TextDirection directionOf(WidgetTester tester, String text) {
  final directionality = find.ancestor(
    of: find.text(text),
    matching: find.byType(Directionality),
  );
  return tester.widget<Directionality>(directionality.first).textDirection;
}

/// Scrolls to [finder], taps it and waits for the result.
Future<void> tapAndSettle(WidgetTester tester, Finder finder) async {
  await tester.ensureVisible(finder);
  await tester.pumpAndSettle();
  await tester.tap(finder);
  await tester.pumpAndSettle();
}

void main() {
  late ReadingHarness harness;

  setUp(() => harness = ReadingHarness());

  group('seed day', () {
    testWidgets('opens the Gospel on the Context tab', (tester) async {
      harness.serveSeedDay();
      useTallScreen(tester);
      await tester.pumpWidget(
        harness.wrap(const ReadingScreen(date: seedDate)),
      );
      expect(find.text('Loading the readings…'), findsOneWidget);
      await tester.pumpAndSettle();

      expect(
        find.text(
          'Twenty-fifth Sunday in Ordinary Time · Sunday 20 September 2026',
        ),
        findsOneWidget,
      );
      expect(find.byType(ChoiceChip), findsNWidgets(4));
      final gospel = tester.widget<ChoiceChip>(
        find.widgetWithText(ChoiceChip, 'Gospel'),
      );
      expect(gospel.selected, isTrue);
      expect(find.text('Mt 20:1-16a'), findsOneWidget);
      expect(find.text('Context'), findsOneWidget);
      expect(find.text('Original'), findsOneWidget);
      expect(find.text('Labourers in the vineyard'), findsOneWidget);
      expect(
        find.textContaining('placed between two sayings'),
        findsOneWidget,
      );
      expect(
        find.textContaining('first. [6]'),
        findsOneWidget,
      );
      expect(find.text('Verified · 5 sources'), findsOneWidget);
      expect(find.text('Report an issue'), findsOneWidget);
      expect(find.textContaining('A study aid'), findsOneWidget);
      expect(find.textContaining('Offline'), findsNothing);
    });

    testWidgets('the Verified badge opens the sources and the review', (
      tester,
    ) async {
      harness.serveSeedDay();
      await pumpReading(tester, harness);

      expect(find.text('Matthew 20:2'), findsNothing);
      await tapAndSettle(tester, find.text('Verified · 5 sources'));
      expect(find.text('Matthew 20:2'), findsOneWidget);
      expect(find.text('1.'), findsOneWidget);
      expect(find.text('6.'), findsOneWidget);
      expect(
        find.text(
          'Approved by a human reviewer after automatic checks. '
          'Last reviewed 3 September 2026',
        ),
        findsOneWidget,
      );
    });

    testWidgets('the Original tab shows the note cards', (tester) async {
      harness.serveSeedDay();
      await pumpReading(tester, harness);

      await tapAndSettle(tester, find.text('Original'));
      expect(find.text('Labourers in the vineyard'), findsNothing);
      expect(find.text('VERSE 15 · “envious”'), findsOneWidget);
      expect(find.text('VERSE 15 · “generous”'), findsOneWidget);
      expect(find.text('ὀφθαλμός σου πονηρός'), findsOneWidget);
      expect(directionOf(tester, 'ὀφθαλμός σου πονηρός'), TextDirection.ltr);
      expect(find.text('ophthalmos sou ponēros'), findsOneWidget);
      expect(find.text('“your eye evil”'), findsOneWidget);
      expect(
        find.text(
          'Greek asks “is your eye evil?”, an idiom for begrudging '
          'another’s good.',
        ),
        findsOneWidget,
      );
      expect(find.text('Verified · 3 sources'), findsOneWidget);
      expect(find.text('Verified · 1 source'), findsOneWidget);
      expect(find.text('Report an issue'), findsNWidgets(2));
    });

    testWidgets('a source opens its page and its archived copy', (
      tester,
    ) async {
      harness.serveSeedDay();
      await pumpReading(tester, harness);
      await tapAndSettle(tester, find.text('Original'));
      await tapAndSettle(tester, find.text('Verified · 3 sources'));

      final lsj = find.textContaining('Liddell, Scott, Jones');
      await tapAndSettle(tester, lsj);
      await tapAndSettle(tester, find.text('Archived copy'));
      expect(harness.launched, hasLength(2));
      expect(harness.launched.first.host, 'www.perseus.tufts.edu');
      expect(harness.launched.last.host, 'web.archive.org');
    });

    testWidgets('Text opens the licensed reading text', (tester) async {
      harness.serveSeedDay();
      await pumpReading(tester, harness);

      expect(find.byTooltip(linkoutLabel), findsOneWidget);
      await tapAndSettle(tester, find.text('Text'));
      expect(harness.launched, [
        Uri.parse('https://www.drbo.org/chapter/47020.htm'),
      ]);
    });

    testWidgets('Report an issue opens the prefilled form', (tester) async {
      harness.serveSeedDay();
      await pumpReading(tester, harness);

      await tapAndSettle(tester, find.text('Report an issue'));
      final context = harness.launched.single;
      expect(context.path, '/nyabongo/lectio/issues/new');
      expect(context.queryParameters['passage'], 'MT.20.1-16');
      expect(context.queryParameters['note'], '_context');
      expect(context.queryParameters['page'], '2026-09-20/gospel/');

      await tapAndSettle(tester, find.text('Original'));
      await tapAndSettle(tester, find.text('Report an issue').last);
      expect(harness.launched.last.queryParameters['note'], 'v15-agathos');
    });

    testWidgets('a link that cannot open says so', (tester) async {
      harness
        ..serveSeedDay()
        ..launchResult = false;
      await pumpReading(tester, harness);

      await tapAndSettle(tester, find.text('Text'));
      expect(find.text('The link could not be opened.'), findsOneWidget);
    });

    testWidgets('a reading without notes is in preparation', (tester) async {
      harness.serveSeedDay();
      await pumpReading(tester, harness);

      await tapAndSettle(tester, find.widgetWithText(ChoiceChip, 'Psalm'));
      expect(find.text('Ps 145:2-3, 8-9, 17-18'), findsOneWidget);
      expect(find.textContaining('in preparation'), findsOneWidget);
      expect(find.byType(TabBar), findsNothing);
      expect(find.textContaining('Verified'), findsNothing);
      await tapAndSettle(tester, find.text('Text'));
      expect(
        harness.launched.single,
        Uri.parse('https://www.drbo.org/chapter/21144.htm'),
      );
    });
  });

  testWidgets('a Hebrew note and excerpt read right to left', (tester) async {
    harness.serveDay(hebrewDay());
    await pumpReading(tester, harness);

    await tapAndSettle(tester, find.text('Original'));
    expect(find.text('VERSE 8 · “kindness”'), findsOneWidget);
    expect(find.text(hebrewWord), findsOneWidget);
    expect(directionOf(tester, hebrewWord), TextDirection.rtl);
    final word = tester.widget<Text>(find.text(hebrewWord));
    expect(word.locale, const Locale('hbo'));
    expect(find.text('ḥesed'), findsOneWidget);
    expect(find.text('“covenant loyalty”'), findsOneWidget);
    // The Greek notes beside it stay left to right.
    expect(directionOf(tester, 'ἀγαθός'), TextDirection.ltr);

    await tapAndSettle(tester, find.text('Verified · 2 sources'));
    expect(find.text(hebrewExcerpt), findsOneWidget);
    expect(directionOf(tester, hebrewExcerpt), TextDirection.rtl);
  });

  testWidgets('a source excerpt without a language is left to right', (
    tester,
  ) async {
    final day = seedDay();
    final sources = gospelOf(day)['sources']! as List<Object?>;
    (sources.first! as Map<String, Object?>)['excerpt'] =
        'excerpt without a language';
    harness.serveDay(day);
    await pumpReading(tester, harness);

    await tapAndSettle(tester, find.text('Verified · 5 sources'));
    expect(
      directionOf(tester, 'excerpt without a language'),
      TextDirection.ltr,
    );
  });

  testWidgets('notes that are not approved are never shown', (tester) async {
    final day = seedDay();
    (gospelOf(day)['review']! as Map<String, Object?>)['status'] = 'pending';
    harness.serveDay(day);
    await pumpReading(tester, harness);

    expect(find.textContaining('in preparation'), findsOneWidget);
    expect(find.text('Labourers in the vineyard'), findsNothing);
    expect(find.textContaining('Verified'), findsNothing);
  });

  testWidgets('approved notes without sources are not verified', (
    tester,
  ) async {
    final day = seedDay();
    final passage = gospelOf(day);
    (passage['context']! as Map<String, Object?>)['paragraphs'] = [
      'A paragraph that cites nothing.',
    ];
    passage['translationNotes'] = <Object?>[];
    harness.serveDay(day);
    await pumpReading(tester, harness);

    expect(find.text('Not yet verified'), findsOneWidget);
    expect(find.textContaining('Verified ·'), findsNothing);

    await tapAndSettle(tester, find.text('Original'));
    expect(
      find.text('There are no original-language notes for this reading yet.'),
      findsOneWidget,
    );
  });

  testWidgets('the auto review method and an unknown review date', (
    tester,
  ) async {
    final day = seedDay();
    (gospelOf(day)['review']! as Map<String, Object?>)
      ..['method'] = 'auto'
      ..['lastReviewedAt'] = null;
    harness.serveDay(day);
    await pumpReading(tester, harness);

    await tapAndSettle(tester, find.text('Verified · 5 sources'));
    expect(
      find.text(
        'Approved after automatic checks and two independent AI verifiers.',
      ),
      findsOneWidget,
    );
    expect(find.textContaining('Last reviewed'), findsNothing);
  });

  testWidgets('a day without readings says so', (tester) async {
    final day = seedDay()
      ..['lectionaryMissing'] = true
      ..['masses'] = <Object?>[];
    harness.serveDay(day);
    await pumpReading(tester, harness);

    expect(
      find.text('There are no readings for this day yet.'),
      findsOneWidget,
    );
    expect(find.byType(ChoiceChip), findsNothing);
  });

  testWidgets('a slot the day does not have says so', (tester) async {
    harness.serveSeedDay();
    await pumpReading(
      tester,
      harness,
      screen: const ReadingScreen(date: seedDate, slot: 'epistle'),
    );

    expect(find.text('This day has no Epistle.'), findsOneWidget);
    expect(find.byType(ChoiceChip), findsNWidgets(4));
    await tapAndSettle(tester, find.widgetWithText(ChoiceChip, 'Gospel'));
    expect(find.text('Labourers in the vineyard'), findsOneWidget);
  });

  testWidgets('a day with one reading has no chooser', (tester) async {
    final day = seedDay();
    readingsOf(day).removeRange(0, 3);
    harness.serveDay(day);
    await pumpReading(tester, harness);

    expect(find.byType(ChoiceChip), findsNothing);
    expect(find.text('Mt 20:1-16a'), findsOneWidget);
  });

  testWidgets('without a date, it opens today', (tester) async {
    harness.serveSeedDay();
    await pumpReading(tester, harness, screen: const ReadingScreen());

    expect(harness.api.paths, [seedDayPath]);
    expect(find.text('Labourers in the vineyard'), findsOneWidget);
  });

  testWidgets('saved notes show offline when refreshing fails', (
    tester,
  ) async {
    await harness.cache.write(
      seedDayPath,
      CachedResponse(
        body: fixture('day'),
        fetchedAt: harness.now.subtract(const Duration(hours: 2)),
      ),
    );
    harness.api.offline = true;
    await pumpReading(tester, harness);

    expect(
      find.text('Offline: showing the notes saved on this device.'),
      findsOneWidget,
    );
    expect(find.text('Labourers in the vineyard'), findsOneWidget);
  });

  testWidgets('a failed load can be retried', (tester) async {
    harness.api.offline = true;
    await pumpReading(tester, harness);

    expect(find.textContaining('could not be loaded'), findsOneWidget);
    harness.api.offline = false;
    harness.serveSeedDay();
    await tapAndSettle(tester, find.text('Try again'));
    expect(find.text('Labourers in the vineyard'), findsOneWidget);
  });

  testWidgets('a new date or slot reloads', (tester) async {
    harness.serveSeedDay();
    await pumpReading(tester, harness);
    expect(find.text('Labourers in the vineyard'), findsOneWidget);

    await tester.pumpWidget(
      harness.wrap(const ReadingScreen(date: seedDate, slot: 'psalm')),
    );
    await tester.pumpAndSettle();
    expect(find.text('Ps 145:2-3, 8-9, 17-18'), findsOneWidget);
    expect(find.textContaining('in preparation'), findsOneWidget);

    await tester.pumpWidget(
      harness.wrap(const ReadingScreen(date: seedDate, slot: 'psalm')),
    );
    await tester.pumpAndSettle();
    expect(find.text('Ps 145:2-3, 8-9, 17-18'), findsOneWidget);
  });

  testWidgets('a new scope reloads from its repository', (tester) async {
    harness.serveSeedDay();
    await pumpReading(tester, harness);
    final requests = harness.api.requests.length;

    final other = ReadingHarness()..serveSeedDay();
    await tester.pumpWidget(other.wrap(const ReadingScreen(date: seedDate)));
    await tester.pumpAndSettle();
    expect(harness.api.requests, hasLength(requests));
    expect(other.api.paths, [seedDayPath]);
    expect(find.text('Labourers in the vineyard'), findsOneWidget);
  });

  group('routes', () {
    Future<void> pumpRouter(WidgetTester tester, String location) async {
      useTallScreen(tester);
      final router = GoRouter(
        initialLocation: location,
        routes: [readingRoute()],
      );
      addTearDown(router.dispose);
      await tester.pumpWidget(
        ReadingScope(
          repository: harness.repository,
          launchLink: harness.launch,
          child: MaterialApp.router(routerConfig: router),
        ),
      );
      await tester.pumpAndSettle();
    }

    test('readingLocation builds the path and the tab', () {
      expect(readingLocation(seedDate, 'gospel'), '/reading/2026-09-20/gospel');
      expect(
        readingLocation(seedDate, 'gospel', tab: ReadingTab.original),
        '/reading/2026-09-20/gospel?tab=original',
      );
    });

    test('ReadingTab.parse falls back to Context', () {
      expect(ReadingTab.parse('original'), ReadingTab.original);
      expect(ReadingTab.parse('context'), ReadingTab.context);
      expect(ReadingTab.parse('text'), ReadingTab.context);
      expect(ReadingTab.parse(null), ReadingTab.context);
    });

    testWidgets('/reading/{date}/{slot}?tab=original', (tester) async {
      harness.serveSeedDay();
      await pumpRouter(
        tester,
        readingLocation(seedDate, 'gospel', tab: ReadingTab.original),
      );
      expect(find.text('VERSE 15 · “envious”'), findsOneWidget);
    });

    testWidgets('/reading/{date}/{slot} for a reading without notes', (
      tester,
    ) async {
      harness.serveSeedDay();
      await pumpRouter(tester, readingLocation(seedDate, 'first-reading'));
      expect(find.text('Is 55:6-9'), findsOneWidget);
      expect(find.textContaining('in preparation'), findsOneWidget);
    });

    testWidgets('/reading opens today on the Context tab', (tester) async {
      harness.serveSeedDay();
      await pumpRouter(tester, '/reading');
      expect(find.text('Labourers in the vineyard'), findsOneWidget);
    });

    testWidgets('/reading with a malformed date fails to load', (
      tester,
    ) async {
      await pumpRouter(tester, '/reading/someday/gospel');
      expect(find.textContaining('could not be loaded'), findsOneWidget);
    });
  });
}
