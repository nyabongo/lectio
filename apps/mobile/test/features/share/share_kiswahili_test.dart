import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:lectio/data/models/day.dart';
import 'package:lectio/features/reading/reading_strings.dart';
import 'package:lectio/features/share/share_button.dart';
import 'package:lectio/features/share/share_sheet.dart';
import 'package:lectio/features/share/site_links.dart';
import 'package:lectio/l10n/lectio_localizations.dart';

import '../../data/fixtures.dart';
import '../reading/reading_harness.dart';
import 'share_button_test.dart' show FakeShareSheet;

final Uri _site = Uri.parse('https://nyabongo.github.io/lectio/');

void main() {
  final day = parseApiDay(fixtureJson('day'));
  final gospel = day.masses.first.readings.last;
  final passage = gospel.passage!;
  final note = passage.translationNotes.first;

  setUpAll(() => initializeDateFormatting('sw'));

  test('localizedPagePath puts Kiswahili pages under sw/', () {
    expect(localizedPagePath('2026-09-20/', 'sw'), 'sw/2026-09-20/');
    expect(localizedPagePath('2026-09-20/', 'en'), '2026-09-20/');
  });

  group('shares in Kiswahili link to the sw pages', () {
    test('a day', () {
      final content = dayShare(day, site: _site, language: 'sw');
      expect(
        content.ref,
        'Twenty-fifth Sunday in Ordinary Time, Jumapili 20 Septemba 2026',
      );
      expect(content.url.toString(), '${_site}sw/2026-09-20/');
    });

    test('a reading', () {
      final content = readingShare(
        seedDate,
        gospel,
        site: _site,
        language: 'sw',
      );
      expect(content.title, 'Mt 20:1-16a · Injili');
      expect(content.url.toString(), '${_site}sw/2026-09-20/gospel/');
    });

    test('an insight', () {
      final content = noteShare(
        passage,
        note,
        '2026-09-20/gospel/',
        site: _site,
        language: 'sw',
      );
      expect(content.title, '“envious” · Mt 20:1-16a, mstari 15');
      expect(
        content.url.toString(),
        '${_site}sw/2026-09-20/gospel/notes/v15-evil-eye/',
      );
    });

    test('the sw links open the same page in the app', () {
      final shares = [
        (
          dayShare(day, site: _site),
          dayShare(day, site: _site, language: 'sw'),
        ),
        (
          readingShare(seedDate, gospel, site: _site),
          readingShare(seedDate, gospel, site: _site, language: 'sw'),
        ),
        (
          noteShare(passage, note, '2026-09-20/gospel/', site: _site),
          noteShare(
            passage,
            note,
            '2026-09-20/gospel/',
            site: _site,
            language: 'sw',
          ),
        ),
      ];
      for (final (english, swahili) in shares) {
        final location = locationForLink(english.url, site: _site);
        expect(location, isNotNull);
        expect(locationForLink(swahili.url, site: _site), location);
      }
    });
  });

  test('ShareStrings and the shared-note label in Kiswahili', () {
    final sw = ShareStrings(LectioLocalizations.forLanguage('sw'));
    expect(sw.shareLabel('Mt 20:1-16a'), 'Shiriki Mt 20:1-16a');
    expect(sw.copied, 'Kiungo kimenakiliwa pamoja na rejeo lake.');
    expect(sw.failed, 'Imeshindwa kushiriki au kunakili kiungo.');
    expect(sw.linkNotRecognised, startsWith('Lectio haina ukurasa'));
    expect(ShareStrings.en.failed, 'Could not share or copy the link.');
    expect(
      ReadingStrings(LectioLocalizations.forLanguage('sw')).linkedNote,
      'Dokezo lililoshirikiwa',
    );
    expect(ReadingStrings.en.linkedNote, 'Shared note');
  });

  testWidgets('the Share button speaks Kiswahili', (tester) async {
    final sheet = FakeShareSheet(ShareOutcome.fallback);
    await tester.pumpWidget(
      MaterialApp(
        locale: const Locale('sw'),
        supportedLocales: supportedLocales,
        localizationsDelegates: lectioLocalizationsDelegates,
        home: Scaffold(
          body: Center(
            child: ShareButton(
              content: readingShare(seedDate, gospel, language: 'sw'),
              sheet: sheet,
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byTooltip('Shiriki Mt 20:1-16a'), findsOneWidget);
  });
}
