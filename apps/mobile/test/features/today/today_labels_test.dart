import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:lectio/features/today/today_labels.dart';
import 'package:lectio/l10n/lectio_localizations.dart';

void main() {
  final strings = TodayStrings.en;
  final sw = TodayStrings(LectioLocalizations.forLanguage('sw'));

  setUpAll(() => initializeDateFormatting('sw'));

  test('seasonName names every season, Ordinary Time by default', () {
    expect(strings.seasonName('advent'), 'Advent');
    expect(strings.seasonName('christmas'), 'Christmas Time');
    expect(strings.seasonName('lent'), 'Lent');
    expect(strings.seasonName('paschal-triduum'), 'Paschal Triduum');
    expect(strings.seasonName('easter'), 'Easter Time');
    expect(strings.seasonName('ordinary-time'), 'Ordinary Time');
    expect(strings.seasonName('unknown'), 'Ordinary Time');
  });

  test('seasonLabel adds the week, except week 0', () {
    expect(strings.seasonLabel('ordinary-time', 25), 'Ordinary Time · Week 25');
    expect(strings.seasonLabel('lent', 0), 'Lent');
  });

  test('rankLabel names every rank, Weekday by default', () {
    expect(strings.rankLabel('solemnity'), 'Solemnity');
    expect(strings.rankLabel('sunday'), 'Sunday');
    expect(strings.rankLabel('feast'), 'Feast');
    expect(strings.rankLabel('memorial'), 'Memorial');
    expect(strings.rankLabel('optional-memorial'), 'Optional memorial');
    expect(strings.rankLabel('commemoration'), 'Commemoration');
    expect(strings.rankLabel('weekday'), 'Weekday');
  });

  test('colourLabel names every colour, Green by default', () {
    expect(strings.colourLabel('white'), 'White');
    expect(strings.colourLabel('red'), 'Red');
    expect(strings.colourLabel('violet'), 'Violet');
    expect(strings.colourLabel('rose'), 'Rose');
    expect(strings.colourLabel('black'), 'Black');
    expect(strings.colourLabel('gold'), 'Gold');
    expect(strings.colourLabel('green'), 'Green');
    expect(strings.colourLabel('teal'), 'Green');
    expect(strings.rankAndColourLabel('sunday', 'green'), 'Sunday · Green');
  });

  test('slotLabel names the slots, numbered ones included', () {
    expect(strings.slotLabel('first-reading'), 'First reading');
    expect(strings.slotLabel('psalm'), 'Psalm');
    expect(strings.slotLabel('second-reading'), 'Second reading');
    expect(strings.slotLabel('epistle'), 'Epistle');
    expect(strings.slotLabel('gospel'), 'Gospel');
    expect(strings.slotLabel('reading-3'), 'Reading 3');
    expect(strings.slotLabel('psalm-2'), 'Psalm 2');
    expect(strings.slotLabel('sequence'), 'Reading');
  });

  test('cycles, Mass options and link-out labels', () {
    expect(strings.cyclesLabel('A', 'II'), 'Sunday cycle A · Weekday cycle II');
    expect(
      strings.massOptionsLabel(2),
      'This day has 2 Masses to choose from.',
    );
    expect(strings.massOptionsLabel(1), 'This day has 1 Mass to choose from.');
    expect(
      strings.linkoutSemantics(
        'Mt 20:1-16a',
        Uri.parse('https://www.drbo.org/x.htm'),
      ),
      'Text of Mt 20:1-16a at www.drbo.org (opens outside the app)',
    );
  });

  test('formatDayDate writes the date out', () {
    expect(strings.formatDayDate('2026-09-20'), 'Sunday 20 September 2026');
    expect(strings.formatDayDate('2027-01-01'), 'Friday 1 January 2027');
  });

  test('fixed messages are worded as on the site', () {
    expect(strings.todayHeading, 'Today');
    expect(strings.listen, 'Listen to the notes');
    expect(strings.notes, 'Notes');
    expect(strings.text, 'Text ↗');
    expect(strings.retry, 'Try again');
    expect(strings.languageCode, 'en');
  });

  group('in Kiswahili', () {
    test('labels come from the sw catalogs', () {
      expect(sw.languageCode, 'sw');
      expect(sw.todayHeading, 'Leo');
      expect(sw.backToToday, 'Rudi leo');
      expect(sw.text, 'Andiko ↗');
      expect(
        sw.seasonLabel('ordinary-time', 25),
        'Kipindi cha Kawaida · Juma la 25',
      );
      expect(sw.rankAndColourLabel('sunday', 'green'), 'Dominika · Kijani');
      expect(sw.slotLabel('gospel'), 'Injili');
      expect(sw.slotLabel('psalm-2'), 'Zaburi 2');
      expect(sw.massOptionsLabel(2), 'Siku hii ina Misa 2 za kuchagua.');
      expect(sw.retry, 'Jaribu tena');
    });

    test('dates are written in Kiswahili', () {
      expect(sw.formatDayDate('2026-09-20'), 'Jumapili 20 Septemba 2026');
      expect(formatLongDate('2026-09-20', 'fr'), 'Sunday 20 September 2026');
    });
  });

  testWidgets('of reads the nearest localizations, else English', (
    tester,
  ) async {
    late TodayStrings found;
    await tester.pumpWidget(
      Builder(
        builder: (context) {
          found = TodayStrings.of(context);
          return const SizedBox.shrink();
        },
      ),
    );
    expect(found.languageCode, 'en');
  });
}
