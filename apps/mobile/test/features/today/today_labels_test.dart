import 'package:flutter_test/flutter_test.dart';
import 'package:lectio/features/today/today_labels.dart';

void main() {
  test('seasonName names every season, Ordinary Time by default', () {
    expect(seasonName('advent'), 'Advent');
    expect(seasonName('christmas'), 'Christmas Time');
    expect(seasonName('lent'), 'Lent');
    expect(seasonName('paschal-triduum'), 'Paschal Triduum');
    expect(seasonName('easter'), 'Easter Time');
    expect(seasonName('ordinary-time'), 'Ordinary Time');
    expect(seasonName('unknown'), 'Ordinary Time');
  });

  test('seasonLabel adds the week, except week 0', () {
    expect(seasonLabel('ordinary-time', 25), 'Ordinary Time · Week 25');
    expect(seasonLabel('lent', 0), 'Lent');
  });

  test('rankLabel names every rank, Weekday by default', () {
    expect(rankLabel('solemnity'), 'Solemnity');
    expect(rankLabel('sunday'), 'Sunday');
    expect(rankLabel('feast'), 'Feast');
    expect(rankLabel('memorial'), 'Memorial');
    expect(rankLabel('optional-memorial'), 'Optional memorial');
    expect(rankLabel('commemoration'), 'Commemoration');
    expect(rankLabel('weekday'), 'Weekday');
  });

  test('colourLabel names every colour, Green by default', () {
    expect(colourLabel('white'), 'White');
    expect(colourLabel('red'), 'Red');
    expect(colourLabel('violet'), 'Violet');
    expect(colourLabel('rose'), 'Rose');
    expect(colourLabel('black'), 'Black');
    expect(colourLabel('gold'), 'Gold');
    expect(colourLabel('green'), 'Green');
    expect(colourLabel('teal'), 'Green');
    expect(rankAndColourLabel('sunday', 'green'), 'Sunday · Green');
  });

  test('slotLabel names the slots, numbered ones included', () {
    expect(slotLabel('first-reading'), 'First reading');
    expect(slotLabel('psalm'), 'Psalm');
    expect(slotLabel('second-reading'), 'Second reading');
    expect(slotLabel('epistle'), 'Epistle');
    expect(slotLabel('gospel'), 'Gospel');
    expect(slotLabel('reading-3'), 'Reading 3');
    expect(slotLabel('psalm-2'), 'Psalm 2');
    expect(slotLabel('sequence'), 'Reading');
  });

  test('cycles, Mass options and link-out labels', () {
    expect(cyclesLabel('A', 'II'), 'Sunday cycle A · Weekday cycle II');
    expect(massOptionsLabel(2), 'This day has 2 Masses to choose from.');
    expect(
      linkoutSemantics('Mt 20:1-16a', Uri.parse('https://www.drbo.org/x.htm')),
      'Text of Mt 20:1-16a at www.drbo.org (opens outside the app)',
    );
  });

  test('formatDayDate writes the date out', () {
    expect(formatDayDate('2026-09-20'), 'Sunday 20 September 2026');
    expect(formatDayDate('2027-01-01'), 'Friday 1 January 2027');
  });
}
