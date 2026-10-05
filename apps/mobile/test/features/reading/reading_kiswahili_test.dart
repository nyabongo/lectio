import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lectio/features/reading/reading_scope.dart';
import 'package:lectio/features/reading/reading_screen.dart';
import 'package:lectio/l10n/lectio_localizations.dart';

import 'reading_harness.dart';

/// The Kiswahili mirror's path of the seed day.
const String swSeedDayPath = 'sw/$seedDayPath';

/// Semantics widgets that mark their subtree as English.
Finder markedEnglish() => find.byWidgetPredicate(
  (widget) =>
      widget is Semantics && widget.localeForSubtree == const Locale('en'),
);

void main() {
  late ReadingHarness harness;

  setUp(() => harness = ReadingHarness());

  /// The Reading screen for the seed Gospel, in Kiswahili.
  Future<void> pumpSwahili(WidgetTester tester) async {
    await tester.pumpWidget(
      ReadingScope(
        repository: harness.repository,
        launchLink: harness.launch,
        child: const MaterialApp(
          locale: Locale('sw'),
          supportedLocales: supportedLocales,
          localizationsDelegates: lectioLocalizationsDelegates,
          home: Scaffold(body: ReadingScreen(date: seedDate, slot: 'gospel')),
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  testWidgets('English notes are marked "English only"', (tester) async {
    // The mirror serves the English notes (locale en) when the passage has
    // no reviewed Kiswahili translation.
    harness.api.serve(swSeedDayPath, jsonEncode(seedDay()));

    await pumpSwahili(tester);

    expect(harness.api.paths, [swSeedDayPath]);
    expect(find.text('Kiingereza pekee'), findsOneWidget);
    expect(
      find.text(
        'Madokezo haya bado hayana tafsiri iliyokaguliwa, kwa hiyo '
        'yanaonyeshwa kwa Kiingereza.',
      ),
      findsOneWidget,
    );
    expect(find.text('Muktadha'), findsOneWidget);
    expect(find.text('Asilia'), findsOneWidget);
    expect(markedEnglish(), findsWidgets);
    expect(
      find.text(
        'Twenty-fifth Sunday in Ordinary Time · Jumapili 20 Septemba 2026',
      ),
      findsOneWidget,
    );
  });

  testWidgets('Kiswahili notes are shown as they are', (tester) async {
    final day = seedDay();
    gospelOf(day)['locale'] = 'sw';
    harness.api.serve(swSeedDayPath, jsonEncode(day));

    await pumpSwahili(tester);

    expect(find.text('Kiingereza pekee'), findsNothing);
    // Only the English celebration name is marked.
    expect(markedEnglish(), findsOneWidget);
  });

  testWidgets('a day that cannot be loaded says so in Kiswahili', (
    tester,
  ) async {
    await pumpSwahili(tester);

    expect(
      find.text(
        'Masomo hayakuweza kupakiwa. Angalia muunganisho wako kisha ujaribu '
        'tena.',
      ),
      findsOneWidget,
    );
    expect(find.text('Jaribu tena'), findsOneWidget);
  });
}
