/// Dart line-coverage gate for the Lectio app (L-100).
///
/// Reads `coverage/lcov.info`, written by `flutter test --coverage`, and fails
/// when line coverage of `lib/` is below [minCoverage], or when a `lib/` file
/// is loaded by no test (such a file is missing from lcov, so it would not
/// count against the total). Generated `*.g.dart` and `*.freezed.dart` files
/// are excluded.
///
/// Run from `apps/mobile`: `dart run tool/check_coverage.dart`.
library;

import 'dart:io';

/// The floor: Dart line coverage never drops below 96%.
///
/// `npm run coverage:floor` reads this declaration and CODEOWNERS routes this
/// file to the owner. Never lower it.
const double minCoverage = 96;

/// File suffixes of generated code, which the gate ignores.
const List<String> generatedSuffixes = ['.g.dart', '.freezed.dart'];

/// Whether [path] is generated code.
bool isGenerated(String path) => generatedSuffixes.any(path.endsWith);

/// [path] with forward slashes, made relative to [root] when inside it.
String relativePath(String path, String root) {
  final normal = path.replaceAll(r'\', '/');
  if (root.isEmpty) return normal;
  var prefix = root.replaceAll(r'\', '/');
  if (!prefix.endsWith('/')) prefix = '$prefix/';
  if (!normal.startsWith(prefix)) return normal;
  return normal.substring(prefix.length);
}

/// Hits per line for each source file in an lcov report.
///
/// Reads `SF:` and `DA:` records; paths are made relative to [root] and
/// repeated records for one file are merged, keeping the higher hit count.
Map<String, Map<int, int>> parseLcov(String lcov, {String root = ''}) {
  final files = <String, Map<int, int>>{};
  Map<int, int>? current;
  for (final raw in lcov.split('\n')) {
    final line = raw.trim();
    if (line.startsWith('SF:')) {
      final path = relativePath(line.substring(3), root);
      current = files.putIfAbsent(path, () => <int, int>{});
    } else if (line == 'end_of_record') {
      current = null;
    } else if (line.startsWith('DA:') && current != null) {
      final fields = line.substring(3).split(',');
      if (fields.length < 2) continue;
      final number = int.tryParse(fields[0]);
      final hits = int.tryParse(fields[1]);
      if (number == null || hits == null) continue;
      final previous = current[number] ?? 0;
      current[number] = hits > previous ? hits : previous;
    }
  }
  return files;
}

/// The `.dart` files under `root/dir`, relative to [root] and sorted.
List<String> dartFilesUnder(String root, String dir) {
  final directory = Directory('$root/$dir');
  if (!directory.existsSync()) return [];
  final files = <String>[];
  for (final entity in directory.listSync(recursive: true)) {
    if (entity is File && entity.path.endsWith('.dart')) {
      files.add(relativePath(entity.path, root));
    }
  }
  return files..sort();
}

/// The result of checking `lib/` coverage against a threshold.
class CoverageReport {
  /// Creates a report.
  const CoverageReport({
    required this.found,
    required this.hit,
    required this.misses,
    required this.unloaded,
    required this.threshold,
  });

  /// Instrumented lines in `lib/`.
  final int found;

  /// Lines executed at least once.
  final int hit;

  /// Unexecuted line numbers per file (files with none are left out).
  final Map<String, List<int>> misses;

  /// `lib/` files that no test loaded.
  final List<String> unloaded;

  /// The minimum line coverage, in percent.
  final double threshold;

  /// Line coverage in percent (0 when nothing was instrumented).
  double get percent {
    if (found == 0) return 0;
    return hit * 100 / found;
  }

  /// Why the gate fails; empty when it passes.
  List<String> get problems {
    final problems = <String>[];
    if (found == 0) {
      problems.add('coverage/lcov.info has no line data for lib/');
    } else if (percent < threshold) {
      problems.add(
        'line coverage ${percent.toStringAsFixed(2)}% is below $threshold%',
      );
    }
    for (final file in unloaded) {
      problems.add('$file is not loaded by any test (counts as uncovered)');
    }
    return problems;
  }

  /// Whether the gate passes.
  bool get passed => problems.isEmpty;
}

/// Checks the parsed [lcov] for `lib/` against [threshold].
///
/// [libFiles] are every `.dart` file under `lib/`; any that is not generated
/// and absent from [lcov] is reported as unloaded.
CoverageReport checkCoverage({
  required Map<String, Map<int, int>> lcov,
  required List<String> libFiles,
  double threshold = minCoverage,
}) {
  var found = 0;
  var hit = 0;
  final misses = <String, List<int>>{};
  for (final MapEntry(key: path, value: lines) in lcov.entries) {
    if (!path.startsWith('lib/') || isGenerated(path)) continue;
    final missed = <int>[];
    for (final MapEntry(key: line, value: hits) in lines.entries) {
      if (hits == 0) missed.add(line);
    }
    missed.sort();
    found += lines.length;
    hit += lines.length - missed.length;
    if (missed.isNotEmpty) misses[path] = missed;
  }
  final unloaded = <String>[];
  for (final file in libFiles) {
    if (!isGenerated(file) && !lcov.containsKey(file)) unloaded.add(file);
  }
  return CoverageReport(
    found: found,
    hit: hit,
    misses: misses,
    unloaded: unloaded,
    threshold: threshold,
  );
}

/// Runs the gate for the package at [root]; returns the process exit code.
int run(String root, {required StringSink out, required StringSink err}) {
  final lcovFile = File('$root/coverage/lcov.info');
  if (!lcovFile.existsSync()) {
    err.writeln(
      'check_coverage: coverage/lcov.info not found; '
      'run `flutter test --coverage` first',
    );
    return 1;
  }
  final report = checkCoverage(
    lcov: parseLcov(lcovFile.readAsStringSync(), root: root),
    libFiles: dartFilesUnder(root, 'lib'),
  );
  out.writeln(
    'check_coverage: lib/ line coverage ${report.percent.toStringAsFixed(2)}% '
    '(${report.hit}/${report.found} lines), minimum ${report.threshold}%',
  );
  for (final MapEntry(key: file, value: lines) in report.misses.entries) {
    out.writeln('  $file: uncovered lines ${lines.join(', ')}');
  }
  if (report.passed) return 0;
  for (final problem in report.problems) {
    err.writeln('check_coverage: $problem');
  }
  return 1;
}

/// Entry point: `dart run tool/check_coverage.dart` from `apps/mobile`.
void main() {
  exitCode = run(Directory.current.path, out: stdout, err: stderr);
}
