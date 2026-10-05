import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:lectio/features/share/share_text.dart';

/// The vectors the site's `buildShareText` is tested with.
Map<String, Object?> _vectors() {
  final file = File('../../packages/schema/fixtures/share-text.json');
  return jsonDecode(file.readAsStringSync()) as Map<String, Object?>;
}

String _build(Map<String, Object?> input) {
  return buildShareText(
    ref: input['ref']! as String,
    insight: input['insight'] as String?,
    url: input['url']! as String,
  );
}

void main() {
  final fixture = _vectors();

  test('uses the limits of the shared vectors', () {
    final limits = fixture['limits']! as Map<String, Object?>;
    expect(limits['ref'], refMaxLength);
    expect(limits['insight'], insightMaxLength);
  });

  group('share-text.json vectors', () {
    final vectors = fixture['vectors']! as List<Object?>;
    test('are all here', () => expect(vectors, hasLength(greaterThan(10))));
    for (final vector in vectors.cast<Map<String, Object?>>()) {
      test(vector['name']! as String, () {
        final input = vector['input']! as Map<String, Object?>;
        expect(_build(input), vector['expected']);
      });
    }
  });

  group('share-text.json invalid inputs throw', () {
    final invalid = fixture['invalid']! as List<Object?>;
    for (final vector in invalid.cast<Map<String, Object?>>()) {
      test(vector['name']! as String, () {
        final input = vector['input']! as Map<String, Object?>;
        expect(() => _build(input), throwsArgumentError);
      });
    }
  });

  group('oneLine', () {
    test('collapses only the listed whitespace and trims spaces', () {
      expect(oneLine(' \t a \r\n b \u000B\f'), 'a b');
      expect(oneLine('a  b'), 'a  b');
      expect(oneLine(' '), '');
      expect(oneLine(''), '');
    });
  });

  group('truncate', () {
    test('keeps text within the limit', () {
      expect(truncate('abc', 3), 'abc');
    });

    test('cuts at a space in the second half of the room', () {
      expect(truncate('aaaa bbbb cccc', 12), 'aaaa bbbb…');
    });

    test('cuts mid-word when the last space is early', () {
      expect(truncate('a bbbbbbbbbbbb', 8), 'a bbbbb…');
    });

    test('drops trailing punctuation before the ellipsis', () {
      expect(truncate('aaaa bbbb; cccc', 12), 'aaaa bbbb…');
      expect(truncate('aaaaaaa—– bbbb', 11), 'aaaaaaa…');
    });

    test('counts code points', () {
      expect(truncate('𝔊𝔊𝔊𝔊', 4), '𝔊𝔊𝔊𝔊');
      expect(truncate('𝔊𝔊𝔊𝔊𝔊', 4), '𝔊𝔊𝔊…');
    });
  });

  group('cleanShareUrl', () {
    test('drops the query string and keeps the fragment', () {
      expect(
        cleanShareUrl('https://example.org/a/?utm_source=x#note'),
        'https://example.org/a/#note',
      );
      expect(cleanShareUrl('http://example.org/a?b'), 'http://example.org/a');
    });

    test('writes an empty path as /', () {
      expect(cleanShareUrl('https://example.org'), 'https://example.org/');
      expect(cleanShareUrl('https://a.example?x#y'), 'https://a.example/#y');
    });

    test('rejects anything but an absolute http(s) URL', () {
      for (final url in ['', '/a/', 'ftp://example.org/', 'https:///a', '::']) {
        expect(() => cleanShareUrl(url), throwsArgumentError, reason: url);
      }
    });
  });

  test('shareLines leaves out an empty insight and needs a reference', () {
    expect(shareLines(ref: 'Mt 1:1'), ['Mt 1:1']);
    expect(shareLines(ref: 'Mt 1:1', insight: ' a '), ['Mt 1:1', 'a']);
    expect(() => shareLines(ref: '\n'), throwsArgumentError);
  });
}
