import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:lectio/data/data.dart';
import 'package:lectio/features/today/day_view.dart';
import 'package:lectio/features/today/today_labels.dart';
import 'package:lectio/features/today/today_screen.dart';
import 'package:lectio/src/theme/liturgical_colour.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../data/fake_api.dart';
import '../../data/fixtures.dart';

/// The date of the seed day fixture, and the device's date in these tests.
const String seedDate = '2026-09-20';

/// The device clock: the morning of the seed day.
DateTime clock() => DateTime(2026, 9, 20, 9);

/// The seed day with [edit] applied, as JSON.
String editedDay(void Function(Map<String, Object?> day) edit) {
  final day = fixtureObject('day');
  edit(day);
  return jsonEncode(day);
}

/// The readings of the first Mass of [day].
List<Map<String, Object?>> readingsOf(Map<String, Object?> day) {
  final masses = day['masses']! as List<Object?>;
  final mass = masses.first! as Map<String, Object?>;
  return (mass['readings']! as List<Object?>).cast<Map<String, Object?>>();
}

/// The [Semantics] widget labelled [label].
Finder semanticsLabelled(String label) => find.byWidgetPredicate(
  (widget) => widget is Semantics && widget.properties.label == label,
);

/// Scrolls [finder] into view.
Future<void> reveal(WidgetTester tester, Finder finder) async {
  await tester.ensureVisible(finder);
  await tester.pumpAndSettle();
}

/// Tells the app it moved to [state], as the engine does.
Future<void> sendLifecycle(WidgetTester tester, AppLifecycleState state) {
  return tester.binding.defaultBinaryMessenger.handlePlatformMessage(
    SystemChannels.lifecycle.name,
    SystemChannels.lifecycle.codec.encodeMessage(state.toString()),
    (_) {},
  );
}

/// The location [router] shows.
String location(GoRouter router) {
  return router.routerDelegate.currentConfiguration.uri.toString();
}

/// The accent of the Today screen's theme.
Color accent(WidgetTester tester) {
  final context = tester.element(find.byType(DayHeader));
  return Theme.of(context).colorScheme.primary;
}

void main() {
  late FakeApi api;
  late LectioRepository repository;
  late List<Uri> opened;
  // The device time the screen sees; tests move it to roll the date over.
  late DateTime now;

  setUp(() {
    now = clock();
    api = FakeApi();
    repository = LectioRepository(
      client: ApiClient(httpClient: api.client, baseUrl: FakeApi.baseUrl),
      cache: MemoryApiCache(),
      clock: clock,
    );
    opened = [];
  });

  Future<bool> openSucceeds(Uri url) async {
    opened.add(url);
    return true;
  }

  /// Shows the Today route at [location] inside a minimal tab shell, with
  /// stand-ins for the Reading and Listen tabs that print their query.
  Future<GoRouter> pumpToday(
    WidgetTester tester, {
    String location = '/today',
    UrlOpener? openUrl,
  }) async {
    final router = GoRouter(
      initialLocation: location,
      routes: [
        ShellRoute(
          builder: (context, state, child) => Scaffold(body: child),
          routes: [
            todayRoute(
              repository: repository,
              clock: () => now,
              openUrl: openUrl ?? openSucceeds,
            ),
            GoRoute(
              path: '/reading',
              builder: (context, state) => Text('reading ${state.uri.query}'),
            ),
            GoRoute(
              path: '/listen',
              builder: (context, state) => Text('listen ${state.uri.query}'),
            ),
          ],
        ),
      ],
    );
    addTearDown(router.dispose);
    await tester.pumpWidget(MaterialApp.router(routerConfig: router));
    await tester.pumpAndSettle();
    return router;
  }

  group('seed day', () {
    setUp(() => api.serveFixture('days/$seedDate.json', 'day'));

    testWidgets('shows the date, celebration, colour and readings', (
      tester,
    ) async {
      await pumpToday(tester);

      expect(find.text('TODAY'), findsOneWidget);
      expect(find.text('Sunday 20 September 2026'), findsOneWidget);
      expect(find.text('Twenty-fifth Sunday in Ordinary Time'), findsOneWidget);
      // The colour is named in words, not told by the swatch alone.
      expect(find.text('Sunday · Green'), findsOneWidget);
      expect(find.text('Ordinary Time · Week 25'), findsOneWidget);
      expect(find.text('Sunday cycle A · Weekday cycle II'), findsOneWidget);
      expect(find.text(TodayStrings.backToToday), findsNothing);
      expect(accent(tester), LiturgicalColour.green.light);

      for (final label in [
        'FIRST READING',
        'PSALM',
        'SECOND READING',
        'GOSPEL',
      ]) {
        await reveal(tester, find.text(label));
        expect(find.text(label), findsOneWidget);
      }
      expect(find.text('Mt 20:1-16a'), findsOneWidget);
      expect(
        find.textContaining('A landowner pays the last hired'),
        findsOneWidget,
      );
      expect(find.text(TodayStrings.notesInPreparation), findsNWidgets(3));
      expect(find.text(TodayStrings.notes), findsOneWidget);
      expect(find.text(TodayStrings.text), findsNWidgets(4));
      expect(find.text(TodayStrings.notesMissing), findsNothing);
      expect(find.text(TodayStrings.offline), findsNothing);
      expect(
        semanticsLabelled(
          'Text of Mt 20:1-16a at www.drbo.org (opens outside the app)',
        ),
        findsOneWidget,
      );
      await reveal(tester, find.text(TodayStrings.listen));
      expect(find.text(TodayStrings.listen), findsOneWidget);
    });

    testWidgets('Notes opens the Reading tab for the reading', (tester) async {
      await pumpToday(tester);

      await reveal(tester, find.text(TodayStrings.notes));
      await tester.tap(find.text(TodayStrings.notes));
      await tester.pumpAndSettle();

      expect(
        find.text('reading date=$seedDate&mass=day&slot=gospel'),
        findsOneWidget,
      );
    });

    testWidgets('Listen opens the Listen tab for the day', (tester) async {
      await pumpToday(tester);

      await tester.tap(find.text(TodayStrings.listen));
      await tester.pumpAndSettle();

      expect(find.text('listen date=$seedDate'), findsOneWidget);
    });

    testWidgets('Text ↗ opens the licensed text outside the app', (
      tester,
    ) async {
      await pumpToday(tester);

      await tester.tap(find.text(TodayStrings.text).first);
      await tester.pumpAndSettle();

      expect(opened, [Uri.parse('https://www.drbo.org/chapter/27055.htm')]);
      expect(find.text(TodayStrings.linkFailed), findsNothing);
    });

    testWidgets('a link-out nothing can open says so', (tester) async {
      await pumpToday(tester, openUrl: (url) async => false);

      await tester.tap(find.text(TodayStrings.text).first);
      await tester.pumpAndSettle();

      expect(find.text(TodayStrings.linkFailed), findsOneWidget);
    });

    testWidgets('a link-out that fails to launch says so', (tester) async {
      await pumpToday(
        tester,
        openUrl: (url) async => throw const FormatException('no launcher'),
      );

      await tester.tap(find.text(TodayStrings.text).first);
      await tester.pumpAndSettle();

      expect(find.text(TodayStrings.linkFailed), findsOneWidget);
    });

    for (final linkout in [
      'intent://scan/#Intent;scheme=zxing;end',
      'tel:+254700000000',
      'file:///data/data/io.github.nyabongo.lectio/secrets',
      'http://www.drbo.org/chapter/27055.htm',
    ]) {
      testWidgets('a link-out to ${linkout.split(':').first}: never opens', (
        tester,
      ) async {
        api.serve(
          'days/$seedDate.json',
          editedDay((day) => readingsOf(day).first['linkout'] = linkout),
        );
        await pumpToday(tester);

        await tester.tap(find.text(TodayStrings.text).first);
        await tester.pumpAndSettle();

        expect(opened, isEmpty);
        expect(find.text(TodayStrings.linkFailed), findsOneWidget);
      });
    }

    testWidgets('pulling down while offline keeps the saved day', (
      tester,
    ) async {
      await pumpToday(tester);
      api.offline = true;

      final refresh = tester.state<RefreshIndicatorState>(
        find.byType(RefreshIndicator),
      );
      unawaited(refresh.show());
      await tester.pumpAndSettle();

      expect(find.text(TodayStrings.offline), findsOneWidget);
      expect(find.text(TodayStrings.refreshFailed), findsNothing);
      expect(find.text('Twenty-fifth Sunday in Ordinary Time'), findsOneWidget);
    });

    testWidgets('a server error on refresh is not called offline', (
      tester,
    ) async {
      await pumpToday(tester);
      api.status = 500;

      final refresh = tester.state<RefreshIndicatorState>(
        find.byType(RefreshIndicator),
      );
      unawaited(refresh.show());
      await tester.pumpAndSettle();

      expect(find.text(TodayStrings.refreshFailed), findsOneWidget);
      expect(find.text(TodayStrings.offline), findsNothing);
      expect(find.text('Twenty-fifth Sunday in Ordinary Time'), findsOneWidget);
    });

    testWidgets('the date picker opens another day and comes back', (
      tester,
    ) async {
      final router = await pumpToday(tester);

      await tester.tap(find.byTooltip(TodayStrings.chooseDate));
      await tester.pumpAndSettle();
      await tester.tap(find.text('21'));
      await tester.tap(find.text('OK'));
      await tester.pumpAndSettle();

      expect(location(router), '/today?date=2026-09-21');
      expect(api.paths.last, 'days/2026-09-21.json');
      expect(find.text('Monday 21 September 2026'), findsOneWidget);
      expect(find.text(TodayStrings.emptyDay), findsOneWidget);
      expect(find.text('TODAY'), findsNothing);

      await tester.tap(find.text(TodayStrings.backToToday));
      await tester.pumpAndSettle();

      expect(location(router), '/today');
      expect(find.text('TODAY'), findsOneWidget);
      expect(find.text('Twenty-fifth Sunday in Ordinary Time'), findsOneWidget);
    });

    testWidgets('cancelling the date picker keeps the day', (tester) async {
      await pumpToday(tester);
      final requests = api.requests.length;

      await tester.tap(find.byTooltip(TodayStrings.chooseDate));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();

      expect(api.requests.length, requests);
      expect(find.text('Twenty-fifth Sunday in Ordinary Time'), findsOneWidget);
    });

    testWidgets('an invalid ?date= falls back to today', (tester) async {
      await pumpToday(tester, location: '/today?date=tomorrow');

      expect(find.text('TODAY'), findsOneWidget);
      expect(api.paths, ['days/$seedDate.json']);
    });

    testWidgets('a new date replaces the day shown', (tester) async {
      Widget screen(String? date) => MaterialApp(
        home: Scaffold(
          body: TodayScreen(repository: repository, date: date, clock: clock),
        ),
      );
      await tester.pumpWidget(screen(null));
      await tester.pumpAndSettle();
      expect(find.text('TODAY'), findsOneWidget);

      await tester.pumpWidget(screen('2026-09-19'));
      await tester.pumpAndSettle();

      expect(find.text('Saturday 19 September 2026'), findsOneWidget);
      expect(find.text(TodayStrings.emptyDay), findsOneWidget);

      await tester.pumpWidget(screen('2026-09-19'));
      await tester.pumpAndSettle();
      expect(api.paths, ['days/$seedDate.json', 'days/2026-09-19.json']);
    });
  });

  group('date rollover', () {
    setUp(() {
      api
        ..serveFixture('days/$seedDate.json', 'day')
        ..serveFixture('days/2026-09-21.json', 'day');
    });

    /// Pulls down to refresh, which rebuilds the screen.
    Future<void> pullToRefresh(WidgetTester tester) async {
      final refresh = tester.state<RefreshIndicatorState>(
        find.byType(RefreshIndicator),
      );
      unawaited(refresh.show());
      await tester.pumpAndSettle();
    }

    testWidgets('Back to today reloads /today in place the next day', (
      tester,
    ) async {
      final router = await pumpToday(tester);
      now = DateTime(2026, 9, 21, 7);
      await pullToRefresh(tester);
      expect(find.text(TodayStrings.backToToday), findsOneWidget);

      await tester.tap(find.text(TodayStrings.backToToday));
      await tester.pumpAndSettle();

      expect(location(router), '/today');
      expect(api.paths.last, 'days/2026-09-21.json');
      expect(find.text('Monday 21 September 2026'), findsOneWidget);
      expect(find.text('TODAY'), findsOneWidget);
    });

    testWidgets('picking the new today in the picker reloads in place', (
      tester,
    ) async {
      final router = await pumpToday(tester);
      now = DateTime(2026, 9, 21, 7);

      await tester.tap(find.byTooltip(TodayStrings.chooseDate));
      await tester.pumpAndSettle();
      await tester.tap(find.text('21'));
      await tester.tap(find.text('OK'));
      await tester.pumpAndSettle();

      expect(location(router), '/today');
      expect(api.paths.last, 'days/2026-09-21.json');
      expect(find.text('TODAY'), findsOneWidget);
    });

    testWidgets('resuming the next day moves to the new date', (tester) async {
      await pumpToday(tester);
      now = DateTime(2026, 9, 21, 7);

      await sendLifecycle(tester, AppLifecycleState.inactive);
      await sendLifecycle(tester, AppLifecycleState.resumed);
      await tester.pumpAndSettle();

      expect(api.paths.last, 'days/2026-09-21.json');
      expect(find.text('Monday 21 September 2026'), findsOneWidget);
      expect(find.text('TODAY'), findsOneWidget);
    });

    testWidgets('resuming keeps a date opened by link', (tester) async {
      await pumpToday(tester, location: '/today?date=$seedDate');
      final requests = api.requests.length;
      now = DateTime(2026, 9, 21, 7);

      await sendLifecycle(tester, AppLifecycleState.inactive);
      await sendLifecycle(tester, AppLifecycleState.resumed);
      await tester.pumpAndSettle();

      expect(api.requests.length, requests);
      expect(find.text('Sunday 20 September 2026'), findsOneWidget);
    });
  });

  group('empty day', () {
    testWidgets('a date with no day document says so', (tester) async {
      await pumpToday(tester);

      expect(find.text('TODAY'), findsOneWidget);
      expect(find.text('Sunday 20 September 2026'), findsOneWidget);
      expect(find.text(TodayStrings.emptyDay), findsOneWidget);
      expect(find.text(TodayStrings.retry), findsNothing);
      expect(find.text(TodayStrings.listen), findsNothing);
      expect(find.byType(ReadingCard), findsNothing);
    });

    testWidgets('a ?date= deep link opens that date', (tester) async {
      await pumpToday(tester, location: '/today?date=2026-02-30');

      expect(api.paths, ['days/2026-03-02.json']);
      expect(find.text('Monday 2 March 2026'), findsOneWidget);
      expect(find.text(TodayStrings.backToToday), findsOneWidget);
    });

    testWidgets('a day the lectionary lacks says the readings are missing', (
      tester,
    ) async {
      api.serve(
        'days/$seedDate.json',
        editedDay((day) {
          day['lectionaryMissing'] = true;
          day['masses'] = <Object?>[];
        }),
      );
      await pumpToday(tester);

      expect(find.text(TodayStrings.lectionaryMissing), findsOneWidget);
      expect(find.text(TodayStrings.listen), findsNothing);
      expect(find.byType(ReadingCard), findsNothing);
    });

    testWidgets('a day without notes keeps every link-out', (tester) async {
      api.serve(
        'days/$seedDate.json',
        editedDay((day) {
          for (final reading in readingsOf(day)) {
            reading['passage'] = null;
          }
        }),
      );
      await pumpToday(tester);

      expect(find.text(TodayStrings.notesMissing), findsOneWidget);
      expect(find.text(TodayStrings.listen), findsNothing);
      await reveal(tester, find.text('GOSPEL'));
      expect(find.text(TodayStrings.notes), findsNothing);
      expect(find.text(TodayStrings.notesInPreparation), findsNWidgets(4));
      expect(find.text(TodayStrings.text), findsNWidgets(4));
    });
  });

  testWidgets('a feast with two Masses lists both, tinted by its colour', (
    tester,
  ) async {
    api.serve(
      'days/$seedDate.json',
      editedDay((day) {
        day['colour'] = 'red';
        final celebrations = day['celebrations']! as List<Object?>;
        (celebrations.first! as Map<String, Object?>)
          ..['name'] = 'Saint Example, Martyr'
          ..['rank'] = 'memorial'
          ..['colour'] = 'red';
        celebrations.add({
          'id': 'other',
          'name': 'Saint Other',
          'rank': 'optional-memorial',
          'colour': 'white',
        });
        final masses = day['masses']! as List<Object?>;
        final first = masses.first! as Map<String, Object?>;
        masses.add({...first, 'id': 'vigil', 'label': 'Vigil Mass'});
      }),
    );
    await pumpToday(tester);

    expect(find.text('Saint Example, Martyr'), findsOneWidget);
    expect(find.text('Memorial · Red'), findsOneWidget);
    expect(
      find.text('Saint Other · Optional memorial · White'),
      findsOneWidget,
    );
    expect(accent(tester), LiturgicalColour.red.light);
    expect(find.text(massOptionsLabel(2)), findsOneWidget);
    await reveal(tester, find.text('Mass of the day'));
    expect(find.text('Mass of the day'), findsOneWidget);
    await reveal(tester, find.text('Vigil Mass'));
    expect(find.text('Vigil Mass'), findsOneWidget);

    await reveal(tester, find.text(TodayStrings.notes).last);
    await tester.tap(find.text(TodayStrings.notes).last);
    await tester.pumpAndSettle();
    expect(
      find.text('reading date=$seedDate&mass=vigil&slot=gospel'),
      findsOneWidget,
    );
  });

  testWidgets('a failed load offers to try again', (tester) async {
    api.status = 500;
    await pumpToday(tester);

    expect(find.text(TodayStrings.loadFailed), findsOneWidget);
    expect(find.byType(ReadingCard), findsNothing);

    api
      ..status = null
      ..serveFixture('days/$seedDate.json', 'day');
    await tester.tap(find.text(TodayStrings.retry));
    await tester.pumpAndSettle();

    expect(find.text(TodayStrings.loadFailed), findsNothing);
    expect(find.text('Twenty-fifth Sunday in Ordinary Time'), findsOneWidget);
  });

  group('openExternally', () {
    late List<(Uri, LaunchMode)> launched;

    Future<bool> launch(Uri url, {LaunchMode mode = LaunchMode.inAppWebView}) {
      launched.add((url, mode));
      return Future.value(true);
    }

    setUp(() => launched = []);

    test('launches https links in an external application', () async {
      final url = Uri.parse('https://www.drbo.org/chapter/47020.htm');

      expect(await openExternally(url, launch: launch), isTrue);
      expect(launched, [(url, LaunchMode.externalApplication)]);
    });

    test('refuses every other scheme without launching', () async {
      for (final url in [
        'intent://scan/#Intent;end',
        'tel:+254700000000',
        'file:///etc/hosts',
        'http://www.drbo.org/',
        'sms:+254700000000',
      ]) {
        expect(await openExternally(Uri.parse(url), launch: launch), isFalse);
      }
      expect(launched, isEmpty);
    });
  });

  test('parseIsoDate normalises yyyy-mm-dd and rejects anything else', () {
    expect(parseIsoDate('2026-09-20'), '2026-09-20');
    expect(parseIsoDate('2026-02-30'), '2026-03-02');
    expect(parseIsoDate('2026-9-20'), isNull);
    expect(parseIsoDate(null), isNull);
  });

  test('the Today, Reading and Listen locations carry the date', () {
    expect(todayLocation(seedDate, today: seedDate), '/today');
    expect(
      todayLocation('2026-09-21', today: seedDate),
      '/today?date=2026-09-21',
    );
    expect(
      readingLocation(seedDate, 'vigil', 'gospel'),
      '/reading?date=2026-09-20&mass=vigil&slot=gospel',
    );
    expect(listenLocation(seedDate), '/listen?date=2026-09-20');
  });
}
