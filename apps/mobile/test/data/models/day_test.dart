import 'package:flutter_test/flutter_test.dart';
import 'package:lectio/data/models/day.dart';
import 'package:lectio/src/theme/liturgical_colour.dart';

import '../fixtures.dart';

void main() {
  group('parseApiDay', () {
    test('reads the header of the fixture day', () {
      final day = parseApiDay(fixtureJson('day'));
      expect(day.date, '2026-09-20');
      expect(day.season, 'ordinary-time');
      expect(day.seasonWeek, 25);
      expect(day.sundayCycle, 'A');
      expect(day.weekdayCycle, 'II');
      expect(day.colour, 'green');
      expect(day.liturgicalColour, LiturgicalColour.green);
      expect(day.lectionaryMissing, isFalse);

      final celebration = day.celebrations.single;
      expect(celebration.id, 'ordinary-time-25-sunday');
      expect(celebration.name, 'Twenty-fifth Sunday in Ordinary Time');
      expect(celebration.rank, 'sunday');
      expect(celebration.colour, 'green');
    });

    test('reads readings by reference, with notes only where approved', () {
      final day = parseApiDay(fixtureJson('day'));
      final mass = day.masses.single;
      expect(mass.id, 'day');
      expect(mass.label, 'Mass of the day');
      expect(day.readings.map((r) => r.slot), [
        'first-reading',
        'psalm',
        'second-reading',
        'gospel',
      ]);

      final first = day.readings.first;
      expect(first.ref, 'Is 55:6-9');
      expect(first.key, 'IS.55.6-9');
      expect(first.linkout.scheme, 'https');
      expect(first.passage, isNull);
      expect(day.readings.last.passage!.key, 'MT.20.1-16');
    });

    test('ignores fields it does not know (v1 is additive)', () {
      final json = fixtureObject('day')..['newField'] = {'any': 'thing'};
      final reading = {
        'slot': 'reading-10',
        'ref': 'Gn 1:1',
        'key': 'GN.1.1',
        'linkout': 'https://example.test/gn1',
        'passage': null,
        'segments': <Object?>[],
      };
      json['masses'] = [
        {
          'id': 'vigil',
          'label': 'Vigil',
          'readings': [reading],
        },
      ];
      json['colour'] = 'blue';
      final day = parseApiDay(json);
      expect(day.readings.single.slot, 'reading-10');
      expect(day.liturgicalColour, LiturgicalColour.green);
    });

    test('rejects another apiVersion or a broken day', () {
      final newer = fixtureObject('day')..['apiVersion'] = 2;
      expect(() => parseApiDay(newer), throwsFormatException);
      final broken = fixtureObject('day')..['seasonWeek'] = '25';
      expect(() => parseApiDay(broken), throwsFormatException);
      final badMass = fixtureObject('day')..['masses'] = ['day'];
      expect(() => parseApiDay(badMass), throwsFormatException);
      final badCelebration = fixtureObject('day')..['celebrations'] = [1];
      expect(() => parseApiDay(badCelebration), throwsFormatException);
    });
  });

  group('parseDaySummary', () {
    test('reads a calendar day, with hasNotes and the summary', () {
      final calendar = fixtureObject('calendar');
      final days = calendar['days']! as List<Object?>;
      final day = parseDaySummary(days[1]);
      expect(day.date, '2026-09-20');
      final gospel = day.readings.last;
      expect(gospel.slot, 'gospel');
      expect(gospel.ref, 'Mt 20:1-16a');
      expect(gospel.key, 'MT.20.1-16');
      expect(gospel.linkout.host, 'www.drbo.org');
      expect(gospel.hasNotes, isTrue);
      expect(gospel.summary, startsWith('A landowner'));
      final first = day.readings.first;
      expect(first.hasNotes, isFalse);
      expect(first.summary, isNull);
    });

    test('rejects a reading without hasNotes', () {
      expect(
        () => ReadingSummary.fromJson({
          'slot': 'psalm',
          'ref': 'Ps 1',
          'key': 'PS.1',
          'linkout': 'https://example.test/ps1',
        }),
        throwsFormatException,
      );
    });
  });
}
