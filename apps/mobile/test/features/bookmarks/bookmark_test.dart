import 'package:flutter_test/flutter_test.dart';
import 'package:lectio/features/bookmarks/bookmark.dart';

void main() {
  const day = BookmarkTarget(date: '2026-09-20');
  const reading = BookmarkTarget(date: '2026-09-20', slot: 'gospel');
  const insight = BookmarkTarget(
    date: '2026-09-20',
    slot: 'gospel',
    insight: 'tn-1',
  );
  final savedAt = DateTime.utc(2026, 9, 20, 7, 30);

  group('BookmarkTarget', () {
    test('knows its kind and key', () {
      expect(day.kind, BookmarkKind.day);
      expect(reading.kind, BookmarkKind.reading);
      expect(insight.kind, BookmarkKind.insight);
      expect(day.key, '2026-09-20');
      expect(reading.key, '2026-09-20/gospel');
      expect(insight.key, '2026-09-20/gospel/tn-1');
      expect(insight.toString(), 'BookmarkTarget(2026-09-20/gospel/tn-1)');
      expect(BookmarkKind.insight.label, 'Insight');
    });

    test('round-trips through JSON, leaving out what is not set', () {
      expect(day.toJson(), {'date': '2026-09-20'});
      expect(insight.toJson(), {
        'date': '2026-09-20',
        'slot': 'gospel',
        'insight': 'tn-1',
      });
      for (final target in [day, reading, insight]) {
        expect(BookmarkTarget.fromJson(target.toJson()), target);
      }
    });

    test('compares by value', () {
      const same = BookmarkTarget(date: '2026-09-20', slot: 'gospel');
      expect(reading, same);
      expect(reading.hashCode, same.hashCode);
      expect(reading, isNot(day));
      expect(reading, isNot(insight));
      expect(reading == Object(), isFalse);
    });

    test('rejects malformed targets', () {
      expect(() => BookmarkTarget.fromJson('day'), throwsFormatException);
      expect(
        () => BookmarkTarget.fromJson(const {'date': '20 September'}),
        throwsFormatException,
      );
      expect(
        () => BookmarkTarget.fromJson(const {
          'date': '2026-09-20',
          'insight': 'x',
        }),
        throwsFormatException,
      );
      expect(
        () => BookmarkTarget.fromJson(const {'date': '2026-09-20', 'slot': 3}),
        throwsFormatException,
      );
    });

    test('asserts that an insight has a slot', () {
      expect(
        () => BookmarkTarget(date: day.date, insight: insight.insight),
        throwsAssertionError,
      );
    });
  });

  group('Bookmark', () {
    test('round-trips through JSON in UTC', () {
      final bookmark = Bookmark(
        target: reading,
        title: 'Gospel · Mt 20:1-16',
        savedAt: savedAt.toLocal(),
      );
      final json = bookmark.toJson();
      expect(json['savedAt'], '2026-09-20T07:30:00.000Z');
      final copy = Bookmark.fromJson(json);
      expect(copy.target, reading);
      expect(copy.title, 'Gospel · Mt 20:1-16');
      expect(copy.savedAt, savedAt);
    });

    test('rejects malformed bookmarks', () {
      expect(() => Bookmark.fromJson(null), throwsFormatException);
      expect(
        () => Bookmark.fromJson({
          'target': day.toJson(),
          'title': 'Sunday',
          'savedAt': 'yesterday',
        }),
        throwsFormatException,
      );
    });
  });

  group('PersonalNote', () {
    test('round-trips through JSON', () {
      final note = PersonalNote(
        target: insight,
        title: 'denarius',
        text: 'A day’s wage.',
        createdAt: savedAt,
        updatedAt: savedAt.add(const Duration(hours: 1)),
      );
      final copy = PersonalNote.fromJson(note.toJson());
      expect(copy.target, insight);
      expect(copy.title, 'denarius');
      expect(copy.text, 'A day’s wage.');
      expect(copy.createdAt, savedAt);
      expect(copy.updatedAt, savedAt.add(const Duration(hours: 1)));
    });

    test('rejects malformed notes', () {
      expect(
        () => PersonalNote.fromJson({'target': day.toJson(), 'title': 't'}),
        throwsFormatException,
      );
    });
  });
}
