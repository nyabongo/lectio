import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:lectio/data/data.dart';
import 'package:lectio/features/today/today_screen.dart';
import 'package:lectio/l10n/lectio_localizations.dart';

import '../../data/fake_api.dart';
import '../../data/fixtures.dart';

/// The date of the seed day fixture, and the device's date in these tests.
const String seedDate = '2026-09-20';

/// The seed day with Kiswahili celebration names, as the API sends them.
String dayWithNames({String swStatus = 'provisional'}) {
  final day = fixtureObject('day');
  final celebrations = day['celebrations']! as List<Object?>;
  (celebrations.first! as Map<String, Object?>)['names'] = {
    'en': 'Twenty-fifth Sunday in Ordinary Time',
    'sw': 'Dominika ya 25 ya Mwaka',
    'swStatus': swStatus,
  };
  return jsonEncode(day);
}

/// Semantics widgets that mark their subtree as English.
Finder markedEnglish() => find.byWidgetPredicate(
  (widget) =>
      widget is Semantics &&
      widget.properties.localeForSubtree == const Locale('en'),
);

void main() {
  late FakeApi api;
  late LectioRepository repository;
  late ValueNotifier<Locale> locale;

  setUp(() {
    api = FakeApi();
    repository = LectioRepository(
      client: ApiClient(httpClient: api.client, baseUrl: FakeApi.baseUrl),
      cache: MemoryApiCache(),
      clock: () => DateTime(2026, 9, 20, 9),
    );
    locale = ValueNotifier(const Locale('sw'));
  });

  /// Shows Today in the app's localizations, in [locale]'s language.
  Future<void> pumpToday(WidgetTester tester) async {
    final router = GoRouter(
      initialLocation: '/today',
      routes: [
        todayRoute(
          repository: repository,
          clock: () => DateTime(2026, 9, 20, 9),
          openUrl: (_) async => true,
        ),
      ],
    );
    addTearDown(router.dispose);
    await tester.pumpWidget(
      ValueListenableBuilder<Locale>(
        valueListenable: locale,
        builder: (context, value, _) => MaterialApp.router(
          locale: value,
          supportedLocales: supportedLocales,
          localizationsDelegates: lectioLocalizationsDelegates,
          routerConfig: router,
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  testWidgets('reads the sw mirror and shows the day in Kiswahili', (
    tester,
  ) async {
    api.serve('sw/days/$seedDate.json', dayWithNames());

    await pumpToday(tester);

    expect(api.paths, ['sw/days/$seedDate.json']);
    expect(find.text('LEO'), findsOneWidget);
    expect(find.text('Jumapili 20 Septemba 2026'), findsOneWidget);
    expect(find.text('Dominika ya 25 ya Mwaka'), findsOneWidget);
    expect(find.text('Dominika · Kijani'), findsOneWidget);
    expect(find.text('Kipindi cha Kawaida · Juma la 25'), findsOneWidget);
    expect(find.text('INJILI'), findsOneWidget);
    expect(find.text('Madokezo yanaandaliwa'), findsNWidgets(3));
    // The Gospel's notes are the English fallback (locale en): marked so.
    expect(markedEnglish(), findsOneWidget);
  });

  testWidgets('marks an English fallback name as English', (tester) async {
    api.serve('sw/days/$seedDate.json', dayWithNames(swStatus: 'fallback'));

    await pumpToday(tester);

    expect(find.text('Twenty-fifth Sunday in Ordinary Time'), findsOneWidget);
    expect(markedEnglish(), findsNWidgets(2));
  });

  testWidgets('switching the language reads the other locale', (tester) async {
    api
      ..serve('sw/days/$seedDate.json', dayWithNames())
      ..serve('days/$seedDate.json', dayWithNames());

    await pumpToday(tester);
    expect(find.text('Dominika ya 25 ya Mwaka'), findsOneWidget);

    locale.value = const Locale('en');
    await tester.pumpAndSettle();

    expect(api.paths, ['sw/days/$seedDate.json', 'days/$seedDate.json']);
    expect(find.text('TODAY'), findsOneWidget);
    expect(find.text('Twenty-fifth Sunday in Ordinary Time'), findsOneWidget);
    expect(markedEnglish(), findsNothing);
  });

  testWidgets('says why a missing day is missing, in Kiswahili', (
    tester,
  ) async {
    await pumpToday(tester);

    expect(
      find.text(
        'Bado hakuna siku ya kalenda kwa tarehe hii. Kalenda inaorodhesha '
        'kila siku iliyo tayari.',
      ),
      findsOneWidget,
    );
  });
}
