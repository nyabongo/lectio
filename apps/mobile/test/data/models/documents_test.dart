import 'package:flutter_test/flutter_test.dart';
import 'package:lectio/data/models/documents.dart';

import '../fixtures.dart';

void main() {
  group('ApiIndex', () {
    test('reads index.json', () {
      final index = ApiIndex.fromJson(fixtureJson('index'));
      expect(index.buildDate, '2026-09-20');
      expect(index.timezone, 'Africa/Nairobi');
      expect(index.defaultLocale, 'en');
      expect(index.locales, ['en']);
      expect(
        index.apiRoot,
        Uri.parse('https://nyabongo.github.io/lectio/api/v1/'),
      );
      expect(index.years, [2026]);
      expect(index.dates!.first, '2026-09-19');
      expect(index.dates!.last, '2026-09-21');
      expect(index.passageCount, 1);
      expect(index.endpoints['day'], 'days/{date}.json');
      expect(index.endpoints, hasLength(6));
    });

    test('reads an empty repository', () {
      final index = ApiIndex.fromJson(fixtureJson('index-empty'));
      expect(index.years, isEmpty);
      expect(index.dates, isNull);
      expect(index.passageCount, 0);
    });

    test('rejects a non-string endpoint', () {
      final json = fixtureObject('index')
        ..['endpoints'] = {'day': 1};
      expect(() => ApiIndex.fromJson(json), throwsFormatException);
    });
  });

  group('DateRange', () {
    test('contains its ends and the dates between them', () {
      const range = DateRange(first: '2026-09-19', last: '2026-09-21');
      expect(range.contains('2026-09-19'), isTrue);
      expect(range.contains('2026-09-20'), isTrue);
      expect(range.contains('2026-09-21'), isTrue);
      expect(range.contains('2026-09-18'), isFalse);
      expect(range.contains('2026-09-22'), isFalse);
    });

    test('rejects a malformed range', () {
      expect(() => DateRange.fromJson({'first': 1}), throwsFormatException);
    });
  });

  test('ApiPassage reads passages/{key}.json', () {
    final passage = ApiPassage.fromJson(fixtureJson('passage'));
    expect(passage.passage.key, 'MT.20.1-16');
    expect(passage.passage.translationNotes, hasLength(2));
    expect(passage.dates, ['2026-09-20']);
  });

  test('PassageIndex reads passages/index.json', () {
    final index = PassageIndex.fromJson(fixtureJson('passage-index'));
    final entry = index.passages.single;
    expect(entry.key, 'MT.20.1-16');
    expect(entry.ref, 'Mt 20:1-16a');
    expect(entry.summary, startsWith('A landowner'));
    expect(entry.lastReviewedAt, DateTime.utc(2026, 9, 3, 17, 5));
    expect(entry.dates, ['2026-09-20']);
  });

  test('ApiCalendar reads calendar/{year}.json', () {
    final calendar = ApiCalendar.fromJson(fixtureJson('calendar'));
    expect(calendar.year, 2026);
    expect(calendar.region, 'kenya');
    expect(calendar.days.map((d) => d.date), [
      '2026-09-19',
      '2026-09-20',
      '2026-09-21',
    ]);
    expect(calendar.days.last.colour, 'red');
  });

  test('ApiUpcoming reads upcoming.json', () {
    final upcoming = ApiUpcoming.fromJson(fixtureJson('upcoming'));
    expect(upcoming.timezone, 'Africa/Nairobi');
    expect(upcoming.from, '2026-09-20');
    expect(upcoming.to, '2026-10-03');
    expect(upcoming.days, hasLength(2));
    expect(upcoming.days.first.readings.last.hasNotes, isTrue);
  });

  test('every document checks apiVersion', () {
    const wrong = {'apiVersion': 0};
    expect(() => ApiIndex.fromJson(wrong), throwsFormatException);
    expect(() => ApiPassage.fromJson(wrong), throwsFormatException);
    expect(() => PassageIndex.fromJson(wrong), throwsFormatException);
    expect(() => ApiCalendar.fromJson(wrong), throwsFormatException);
    expect(() => ApiUpcoming.fromJson(wrong), throwsFormatException);
    expect(
      () => PassageIndexEntry.fromJson(<String, Object?>{}),
      throwsFormatException,
    );
  });
}
