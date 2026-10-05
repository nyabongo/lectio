/// Generates the app's UI string catalogs (L-114) from one source of truth.
///
/// The sources are the site's per-feature catalogs,
/// `apps/web/src/i18n/<locale>/<feature>.json`, and the app's own,
/// `lib/l10n/catalog/<locale>/<feature>.json`, for wording only the app
/// needs. Each file is flattened as the site does (`src/lib/i18n.ts`), with
/// `_` between segments: `day.json` → `{"slot": {"psalm": "Psalm"}}` is the
/// key `day_slot_psalm`. A plural message is an object whose keys are all
/// plural categories (`one`, `other` …), as on the site.
///
/// It writes, under `lib/l10n/`:
///
/// - `app_en.arb` and `app_sw.arb`, gen-l10n ARB files (plurals in ICU form),
///   for translators and tools;
/// - `catalog.g.dart`, the same messages as JSON in a Dart string, which
///   `LectioLocalizations` reads at run time.
///
/// Every locale must have every English key, in the same shape and with the
/// same `{placeholders}`, and nothing else.
///
/// From `apps/mobile`: `dart run tool/sync_l10n.dart` rewrites the files;
/// `--check` (run by flutter.yml) only fails when they are out of date.
library;

import 'dart:convert';
import 'dart:io';

/// The UI locales, the first being the fallback.
const List<String> catalogLocales = ['en', 'sw'];

/// Catalog directories, relative to `apps/mobile`: the site's, then the
/// app's.
const List<String> catalogDirs = ['../web/src/i18n', 'lib/l10n/catalog'];

/// Where the generated files go, relative to `apps/mobile`.
const String outputDir = 'lib/l10n';

/// The generated Dart catalog, relative to `apps/mobile`.
const String dartCatalogPath = '$outputDir/catalog.g.dart';

/// The ARB file of [locale], relative to `apps/mobile`.
String arbPath(String locale) => '$outputDir/app_$locale.arb';

/// Plural categories, in CLDR order.
const List<String> pluralCategories = [
  'zero',
  'one',
  'two',
  'few',
  'many',
  'other',
];

final RegExp _segment = RegExp(r'^[A-Za-z0-9]+$');
final RegExp _placeholder = RegExp(r'\{(\w+)\}');

/// A catalog that cannot be turned into the app's strings.
class CatalogException implements Exception {
  /// Creates the error with its [message].
  const new(this.message);

  /// What is wrong, naming the file and key.
  final String message;

  @override
  String toString() => message;
}

/// Whether [value] is a plural message: two or more string values whose keys
/// are all plural categories, including `one` or `other`.
bool looksPlural(Map<String, Object?> value) {
  final keys = value.keys;
  return keys.length >= 2 &&
      (keys.contains('one') || keys.contains('other')) &&
      keys.every(
        (key) => pluralCategories.contains(key) && value[key] is String,
      );
}

/// Flattens one catalog file's [value] into [into], under [key]. [path]
/// names the file in errors.
void flattenCatalog(
  Object? value,
  String key,
  String path,
  Map<String, Object> into,
) {
  if (value is String) {
    into[key] = value;
    return;
  }
  if (value is! Map<String, Object?>) {
    throw CatalogException('$path: "$key" must be a string or an object');
  }
  if (looksPlural(value)) {
    if (value['other'] == null) {
      throw CatalogException('$path: plural "$key" needs an "other" form');
    }
    into[key] = {
      for (final category in pluralCategories)
        if (value[category] case final String text) category: text,
    };
    return;
  }
  if (value.isEmpty) throw CatalogException('$path: "$key" is empty');
  for (final MapEntry(key: name, value: child) in value.entries) {
    if (!_segment.hasMatch(name)) {
      throw CatalogException(
        '$path: key "$name" under "$key" must be letters and digits',
      );
    }
    flattenCatalog(child, '${key}_$name', path, into);
  }
}

/// The messages of every locale, read from the `<locale>/<feature>.json`
/// files under [dirs] (relative to [root]), features in name order.
///
/// A feature defined in two directories is an error, as is a locale with no
/// catalog at all.
Map<String, Map<String, Object>> readCatalogs(
  String root, {
  List<String> dirs = catalogDirs,
  List<String> locales = catalogLocales,
}) {
  final catalogs = <String, Map<String, Object>>{};
  for (final locale in locales) {
    final files = <String, File>{};
    for (final dir in dirs) {
      final directory = Directory('$root/$dir/$locale');
      if (!directory.existsSync()) continue;
      for (final entity in directory.listSync()) {
        final name = entity.uri.pathSegments.last;
        if (entity is! File || !name.endsWith('.json')) continue;
        final feature = name.substring(0, name.length - '.json'.length);
        final path = '$dir/$locale/$name';
        if (!_segment.hasMatch(feature)) {
          throw CatalogException(
            '$path: the feature name must be letters and digits',
          );
        }
        final previous = files[feature];
        if (previous != null) {
          throw CatalogException(
            '$path: feature "$feature" is also defined in ${previous.path}',
          );
        }
        files[feature] = entity;
      }
    }
    if (files.isEmpty) {
      throw CatalogException('no catalog for locale "$locale"');
    }
    final messages = <String, Object>{};
    for (final feature in files.keys.toList()..sort()) {
      final file = files[feature]!;
      final Object? json;
      try {
        json = jsonDecode(file.readAsStringSync());
      } on FormatException catch (error) {
        throw CatalogException('${file.path}: ${error.message}');
      }
      flattenCatalog(json, feature, file.path, messages);
    }
    catalogs[locale] = messages;
  }
  return catalogs;
}

/// The `{name}` placeholders of [message], every plural form together,
/// sorted.
List<String> placeholdersOf(Object message) {
  final texts = message is Map<String, String>
      ? message.values
      : [message as String];
  return {
    for (final text in texts)
      for (final match in _placeholder.allMatches(text)) match.group(1)!,
  }.toList()..sort();
}

String _shape(Object message) {
  final kind = message is String ? 'text' : 'plural';
  return [kind, ...placeholdersOf(message)].join(' ');
}

/// Why the [catalogs] do not match the first locale's: missing or extra
/// keys, or a message whose shape or placeholders differ. Empty when they
/// match.
List<String> parityProblems(Map<String, Map<String, Object>> catalogs) {
  final problems = <String>[];
  final base = catalogs.entries.first;
  final others = catalogs.entries.skip(1);
  for (final MapEntry(key: locale, value: messages) in others) {
    for (final MapEntry(:key, :value) in base.value.entries) {
      final translated = messages[key];
      if (translated == null) {
        problems.add('$locale: missing "$key"');
      } else if (_shape(translated) != _shape(value)) {
        problems.add(
          '$locale: "$key" is "${_shape(translated)}", '
          '${base.key} is "${_shape(value)}"',
        );
      }
    }
    for (final key in messages.keys) {
      if (!base.value.containsKey(key)) {
        problems.add('$locale: "$key" is not in ${base.key}');
      }
    }
  }
  return problems;
}

/// [message] as an ARB (ICU) message: plain text, or
/// `{count, plural, one{…} other{…}}`.
String icuMessage(Object message) {
  if (message is String) return message;
  final forms = (message as Map<String, String>).entries
      .map((form) => '${form.key}{${form.value}}')
      .join(' ');
  return '{count, plural, $forms}';
}

const JsonEncoder _json = JsonEncoder.withIndent('  ');

/// The ARB file of [locale]; the template ([withMetadata]) also describes
/// each message's placeholders.
String arbSource(
  String locale,
  Map<String, Object> messages, {
  required bool withMetadata,
}) {
  final arb = <String, Object>{'@@locale': locale};
  for (final MapEntry(:key, :value) in messages.entries) {
    arb[key] = icuMessage(value);
    final placeholders = placeholdersOf(value);
    if (withMetadata && placeholders.isNotEmpty) {
      arb['@$key'] = {
        'placeholders': {
          for (final name in placeholders)
            name: value is String || name != 'count'
                ? <String, Object>{}
                : {'type': 'num'},
        },
      };
    }
  }
  return '${_json.convert(arb)}\n';
}

/// The Dart catalog: every locale's messages as JSON in a raw string.
String dartSource(Map<String, Map<String, Object>> catalogs) {
  final json = _json.convert(catalogs);
  if (json.contains("'''")) {
    throw const CatalogException("a message contains ''' (see dartSource)");
  }
  return '// GENERATED by tool/sync_l10n.dart from apps/web/src/i18n and '
      'lib/l10n/catalog.\n'
      '// Do not edit: run `dart run tool/sync_l10n.dart` in apps/mobile.\n'
      '// Kiswahili strings are provisional until a native speaker reviews '
      'them (#221).\n'
      '\n'
      '/// Every UI message by locale and key, read by LectioLocalizations.\n'
      "const String catalogJson = r'''\n"
      '$json\n'
      "''';\n";
}

/// Every generated file, by path relative to `apps/mobile`.
Map<String, String> generatedFiles(Map<String, Map<String, Object>> catalogs) {
  final problems = parityProblems(catalogs);
  if (problems.isNotEmpty) throw CatalogException(problems.join('\n'));
  final fallback = catalogs.keys.first;
  return {
    for (final MapEntry(key: locale, value: messages) in catalogs.entries)
      arbPath(locale): arbSource(
        locale,
        messages,
        withMetadata: locale == fallback,
      ),
    dartCatalogPath: dartSource(catalogs),
  };
}

/// Writes the generated files under [root] (`apps/mobile`), or with [check]
/// only reports the ones that are out of date. Returns the exit code.
int run(
  String root, {
  required StringSink out,
  required StringSink err,
  bool check = false,
}) {
  final Map<String, String> files;
  try {
    files = generatedFiles(readCatalogs(root));
  } on CatalogException catch (error) {
    err.writeln('sync_l10n: $error');
    return 1;
  }
  final stale = <String>[];
  for (final MapEntry(key: path, value: content) in files.entries) {
    final file = File('$root/$path');
    if (file.existsSync() && file.readAsStringSync() == content) continue;
    stale.add(path);
    if (!check) {
      file
        ..createSync(recursive: true)
        ..writeAsStringSync(content);
    }
  }
  if (check && stale.isNotEmpty) {
    err.writeln(
      'sync_l10n: out of date: ${stale.join(', ')}. Run '
      '`dart run tool/sync_l10n.dart` in apps/mobile and commit the result.',
    );
    return 1;
  }
  final verb = check ? 'up to date' : 'wrote ${stale.length} file(s)';
  out.writeln('sync_l10n: $verb (${files.length} generated files)');
  return 0;
}

/// Entry point, from `apps/mobile`: `dart run tool/sync_l10n.dart [--check]`.
void main(List<String> args) {
  exitCode = run(
    Directory.current.path,
    out: stdout,
    err: stderr,
    check: args.contains('--check'),
  );
}
