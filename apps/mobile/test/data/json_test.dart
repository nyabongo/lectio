import 'package:flutter_test/flutter_test.dart';
import 'package:lectio/data/json.dart';

void main() {
  group('asJsonObject', () {
    test('returns objects', () {
      final object = <String, Object?>{'a': 1};
      expect(asJsonObject(object), same(object));
    });

    test('rejects anything else, naming the field', () {
      expect(
        () => asJsonObject([1], 'context'),
        throwsA(
          isA<FormatException>().having(
            (e) => e.message,
            'message',
            contains('"context"'),
          ),
        ),
      );
      expect(() => asJsonObject(null), throwsFormatException);
    });
  });

  group('asApiDocument', () {
    test('accepts apiVersion 1', () {
      final document = {'apiVersion': 1, 'extra': true};
      expect(asApiDocument(document), same(document));
    });

    test('rejects other versions and missing versions', () {
      expect(() => asApiDocument({'apiVersion': 2}), throwsFormatException);
      expect(() => asApiDocument(<String, Object?>{}), throwsFormatException);
    });
  });

  group('JsonRead', () {
    final object = <String, Object?>{
      's': 'text',
      'i': 3,
      'b': true,
      'n': 74.5,
      'whole': 74,
      'u': 'https://example.test/a',
      't': '2026-09-03T17:05:00Z',
      'o': {'x': 1},
      'nil': null,
      'ss': ['a', 'b'],
      'is': [1, 2],
      'mixed': ['a', 1],
    };

    test('reads required fields', () {
      expect(object.string('s'), 'text');
      expect(object.integer('i'), 3);
      expect(object.boolean('b'), isTrue);
      expect(object.uri('u'), Uri.parse('https://example.test/a'));
      expect(object.object('o'), {'x': 1});
      expect(object.strings('ss'), ['a', 'b']);
      expect(object.integers('is'), [1, 2]);
    });

    test('reads optional fields, null or absent', () {
      expect(object.optionalString('s'), 'text');
      expect(object.optionalString('nil'), isNull);
      expect(object.optionalString('absent'), isNull);
      expect(object.optionalNumber('n'), 74.5);
      expect(object.optionalNumber('whole'), 74.0);
      expect(object.optionalNumber('absent'), isNull);
      expect(object.optionalUri('u'), Uri.parse('https://example.test/a'));
      expect(object.optionalUri('nil'), isNull);
      expect(
        object.optionalDateTime('t'),
        DateTime.utc(2026, 9, 3, 17, 5),
      );
      expect(object.optionalDateTime('absent'), isNull);
      expect(object.optionalObject('o'), {'x': 1});
      expect(object.optionalObject('nil'), isNull);
    });

    test('rejects the wrong type, naming the field', () {
      expect(
        () => object.string('i'),
        throwsA(
          isA<FormatException>().having(
            (e) => e.message,
            'message',
            'Expected String for "i"',
          ),
        ),
      );
      expect(() => object.integer('n'), throwsFormatException);
      expect(() => object.boolean('absent'), throwsFormatException);
      expect(() => object.optionalString('i'), throwsFormatException);
      expect(() => object.optionalNumber('s'), throwsFormatException);
      expect(() => object.object('s'), throwsFormatException);
      expect(() => object.optionalObject('s'), throwsFormatException);
      expect(() => object.strings('s'), throwsFormatException);
      expect(() => object.strings('mixed'), throwsFormatException);
      expect(() => object.integers('ss'), throwsFormatException);
      expect(() => object.optionalDateTime('s'), throwsFormatException);
    });

    test('returns unmodifiable lists', () {
      expect(() => object.strings('ss').add('c'), throwsUnsupportedError);
    });

    test('maps list items with the parser', () {
      expect(object.list('is', (item) => '$item!'), ['1!', '2!']);
    });
  });
}
