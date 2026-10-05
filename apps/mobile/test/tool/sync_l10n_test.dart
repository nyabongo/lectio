import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

import '../../tool/sync_l10n.dart' hide main;

/// Flattens [json] as the file `<feature>.json`.
Map<String, Object> flat(Object? json, {String feature = 'day'}) {
  final into = <String, Object>{};
  flattenCatalog(json, feature, 'en/$feature.json', into);
  return into;
}

/// Writes catalog [files] (`<dir>/<locale>/<feature>.json` → JSON) under a
/// new temporary directory and returns it.
Directory catalogTree(Map<String, Object?> files) {
  final root = Directory.systemTemp.createTempSync('sync_l10n_');
  addTearDown(() => root.deleteSync(recursive: true));
  for (final MapEntry(key: path, value: json) in files.entries) {
    File('${root.path}/$path')
      ..createSync(recursive: true)
      ..writeAsStringSync(json is String ? json : jsonEncode(json));
  }
  return root;
}

/// A matching pair of site and app catalogs.
Map<String, Object?> validTree() => {
  'web/en/day.json': {
    'title': 'Today',
    'count': {'one': '{count} day', 'other': '{count} days'},
  },
  'web/sw/day.json': {
    'title': 'Leo',
    'count': {'one': 'siku {count}', 'other': 'siku {count}'},
  },
  'app/en/app.json': {
    'retry': 'Try {what} again',
  },
  'app/sw/app.json': {
    'retry': 'Jaribu {what} tena',
  },
};

const List<String> testDirs = ['web', 'app'];

void main() {
  group('looksPlural', () {
    test('needs two or more plural categories with one or other', () {
      expect(looksPlural({'one': 'a', 'other': 'b'}), isTrue);
      expect(looksPlural({'few': 'a', 'other': 'b'}), isTrue);
      expect(looksPlural({'other': 'a'}), isFalse);
      expect(looksPlural({'one': 'a', 'label': 'b'}), isFalse);
      expect(looksPlural({'zero': 'a', 'two': 'b'}), isFalse);
      expect(looksPlural({'one': 'a', 'other': <String, Object?>{}}), isFalse);
    });
  });

  group('flattenCatalog', () {
    test('joins nested keys with _ under the feature', () {
      expect(
        flat({
          'title': 'Today',
          'slot': {'psalm': 'Psalm', 'psalmN': 'Psalm {n}'},
        }),
        {
          'day_title': 'Today',
          'day_slot_psalm': 'Psalm',
          'day_slot_psalmN': 'Psalm {n}',
        },
      );
    });

    test('keeps plural messages whole, in CLDR order', () {
      final messages = flat({
        'masses': {'other': '{count} Masses', 'one': '{count} Mass'},
      });
      expect(messages, {
        'day_masses': {'one': '{count} Mass', 'other': '{count} Masses'},
      });
      expect((messages['day_masses']! as Map).keys, ['one', 'other']);
    });

    test('rejects values that are not strings or objects', () {
      expect(() => flat({'n': 1}), throwsA(isA<CatalogException>()));
    });

    test('rejects a plural without other', () {
      expect(
        () => flat({
          'n': {'one': 'a', 'few': 'b'},
        }),
        throwsA(
          isA<CatalogException>().having(
            (error) => error.message,
            'message',
            contains('"day_n" needs an "other" form'),
          ),
        ),
      );
    });

    test('rejects empty objects and keys that are not identifiers', () {
      expect(
        () => flat({'n': <String, Object?>{}}),
        throwsA(isA<CatalogException>()),
      );
      expect(
        () => flat({'a-b': 'x'}),
        throwsA(
          isA<CatalogException>().having(
            (error) => error.toString(),
            'toString',
            contains('key "a-b"'),
          ),
        ),
      );
    });
  });

  group('placeholdersOf', () {
    test('lists each placeholder once, sorted, across plural forms', () {
      expect(placeholdersOf('{b} and {a} and {b}'), ['a', 'b']);
      expect(
        placeholdersOf(<String, String>{'one': '{count} x', 'other': '{n}'}),
        ['count', 'n'],
      );
      expect(placeholdersOf('none'), isEmpty);
    });
  });

  group('parityProblems', () {
    Map<String, Map<String, Object>> catalogs(Map<String, Object> sw) => {
      'en': {
        'a': 'A {x}',
        'b': <String, String>{'one': '1', 'other': '{count}'},
      },
      'sw': sw,
    };

    test('is empty when every key matches', () {
      expect(
        parityProblems(
          catalogs({
            'a': 'A {x} sw',
            'b': <String, String>{'one': 'moja', 'other': '{count}'},
          }),
        ),
        isEmpty,
      );
    });

    test('reports missing, extra and mismatched keys', () {
      expect(
        parityProblems(catalogs({'a': 'A', 'c': 'C'})),
        [
          'sw: "a" is "text", en is "text x"',
          'sw: missing "b"',
          'sw: "c" is not in en',
        ],
      );
      expect(parityProblems(catalogs({'a': 'A {x}', 'b': 'B {count}'})), [
        'sw: "b" is "text count", en is "plural count"',
      ]);
    });
  });

  group('icuMessage', () {
    test('writes plain text as is and plurals in ICU form', () {
      expect(icuMessage('Psalm {n}'), 'Psalm {n}');
      expect(
        icuMessage(<String, String>{'one': '{count} Mass', 'other': 'Masses'}),
        '{count, plural, one{{count} Mass} other{Masses}}',
      );
    });
  });

  group('arbSource', () {
    final messages = <String, Object>{
      'a': 'Plain',
      'b': 'Hello {name}',
      'c': <String, String>{'one': '{count} day', 'other': '{count} days'},
    };

    test('describes the placeholders in the template', () {
      final arb = jsonDecode(arbSource('en', messages, withMetadata: true));
      expect(arb, {
        '@@locale': 'en',
        'a': 'Plain',
        'b': 'Hello {name}',
        '@b': {
          'placeholders': {'name': <String, Object?>{}},
        },
        'c': '{count, plural, one{{count} day} other{{count} days}}',
        '@c': {
          'placeholders': {
            'count': {'type': 'num'},
          },
        },
      });
    });

    test('leaves the metadata out of translations', () {
      final arb = arbSource('sw', messages, withMetadata: false);
      expect(arb, endsWith('}\n'));
      expect((jsonDecode(arb) as Map).keys, ['@@locale', 'a', 'b', 'c']);
    });
  });

  group('dartSource', () {
    test('embeds the catalogs as JSON in a raw string', () {
      final catalogs = {
        'en': <String, Object>{'a': r"""It's "a" \ b"""},
      };
      final source = dartSource(catalogs);
      expect(source, startsWith('// GENERATED by tool/sync_l10n.dart'));
      final json = source.substring(
        source.indexOf("r'''\n") + 5,
        source.lastIndexOf("\n''';"),
      );
      expect(jsonDecode(json), catalogs);
    });

    test("refuses a message containing '''", () {
      expect(
        () => dartSource({
          'en': {'a': "'''"},
        }),
        throwsA(isA<CatalogException>()),
      );
    });
  });

  group('readCatalogs', () {
    test('merges the directories feature by feature, per locale', () {
      final root = catalogTree(validTree());
      final catalogs = readCatalogs(root.path, dirs: testDirs);
      expect(catalogs.keys, ['en', 'sw']);
      expect(catalogs['en']!.keys, ['app_retry', 'day_title', 'day_count']);
      expect(catalogs['sw']!['day_title'], 'Leo');
    });

    test('ignores files that are not JSON catalogs', () {
      final root = catalogTree({
        ...validTree(),
        'web/sw/catalog.test.ts': 'export {};',
      });
      Directory('${root.path}/web/en/nested').createSync();
      expect(
        readCatalogs(root.path, dirs: testDirs)['sw']!.keys,
        hasLength(3),
      );
    });

    test('rejects a feature defined twice', () {
      final root = catalogTree({
        ...validTree(),
        'app/en/day.json': {'title': 'Again'},
      });
      expect(
        () => readCatalogs(root.path, dirs: testDirs),
        throwsA(
          isA<CatalogException>().having(
            (error) => error.message,
            'message',
            contains('feature "day" is also defined'),
          ),
        ),
      );
    });

    test('rejects a locale without catalogs', () {
      final root = catalogTree({'web/en/day.json': {'title': 'Today'}});
      expect(
        () => readCatalogs(root.path, dirs: testDirs),
        throwsA(
          isA<CatalogException>().having(
            (error) => error.message,
            'message',
            'no catalog for locale "sw"',
          ),
        ),
      );
    });

    test('rejects bad feature names and malformed JSON', () {
      expect(
        () => readCatalogs(
          catalogTree({
            ...validTree(),
            'web/en/my-day.json': {'a': 'b'},
          }).path,
          dirs: testDirs,
        ),
        throwsA(isA<CatalogException>()),
      );
      expect(
        () => readCatalogs(
          catalogTree({...validTree(), 'web/en/bad.json': '{'}).path,
          dirs: testDirs,
        ),
        throwsA(isA<CatalogException>()),
      );
    });
  });

  group('generatedFiles', () {
    test('writes an ARB per locale and the Dart catalog', () {
      final files = generatedFiles(
        readCatalogs(catalogTree(validTree()).path, dirs: testDirs),
      );
      expect(files.keys, [
        'lib/l10n/app_en.arb',
        'lib/l10n/app_sw.arb',
        'lib/l10n/catalog.g.dart',
      ]);
      expect(files['lib/l10n/app_en.arb'], contains('"@day_count"'));
      expect(files['lib/l10n/app_sw.arb'], isNot(contains('"@day_count"')));
    });

    test('refuses catalogs that do not match', () {
      expect(
        () => generatedFiles({
          'en': {'a': 'A'},
          'sw': <String, Object>{},
        }),
        throwsA(isA<CatalogException>()),
      );
    });
  });

  group('run', () {
    /// The repository layout in a temporary directory: the site's catalogs
    /// under `web/src/i18n`, the app's under `mobile/lib/l10n/catalog`.
    /// Returns the app's directory, where the tool runs.
    String appTree() {
      final tree = validTree();
      final root = catalogTree({
        for (final MapEntry(:key, :value) in tree.entries)
          key
                  .replaceFirst('web/', 'web/src/i18n/')
                  .replaceFirst('app/', 'mobile/lib/l10n/catalog/'):
              value,
      });
      return '${root.path}/mobile';
    }

    test('writes the files, then finds them up to date', () {
      final app = appTree();
      final out = StringBuffer();
      final err = StringBuffer();
      expect(run(app, out: out, err: err, check: true), 1);
      expect(err.toString(), contains('out of date'));
      expect(File('$app/$dartCatalogPath').existsSync(), isFalse);

      expect(run(app, out: out, err: err), 0);
      expect(out.toString(), contains('wrote 3 file(s)'));
      expect(File('$app/$dartCatalogPath').existsSync(), isTrue);

      out.clear();
      expect(run(app, out: out, err: err, check: true), 0);
      expect(out.toString(), contains('up to date'));
    });

    test('fails on a broken catalog', () {
      final root = catalogTree({});
      final err = StringBuffer();
      expect(run(root.path, out: StringBuffer(), err: err), 1);
      expect(err.toString(), contains('no catalog for locale'));
    });
  });

  test('the committed files match the catalogs', () {
    // The same check as flutter.yml's sync step, run from apps/mobile.
    final files = generatedFiles(readCatalogs('.'));
    for (final MapEntry(key: path, value: content) in files.entries) {
      expect(File(path).readAsStringSync(), content, reason: path);
    }
  });
}
