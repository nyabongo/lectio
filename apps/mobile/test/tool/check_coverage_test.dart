import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

import '../../tool/check_coverage.dart' hide main;

/// An lcov record for [path] with the given hit count per line.
String record(String path, Map<int, int> hits) {
  final buffer = StringBuffer('SF:$path\n');
  for (final MapEntry(key: line, value: count) in hits.entries) {
    buffer.writeln('DA:$line,$count');
  }
  return '${buffer}LF:${hits.length}\nend_of_record\n';
}

void main() {
  test('the threshold is the 96% floor', () {
    expect(minCoverage, 96);
  });

  test('isGenerated matches *.g.dart and *.freezed.dart', () {
    expect(isGenerated('lib/model.g.dart'), isTrue);
    expect(isGenerated('lib/model.freezed.dart'), isTrue);
    expect(isGenerated('lib/model.dart'), isFalse);
  });

  group('relativePath', () {
    test('strips the root and normalises separators', () {
      expect(relativePath('/app/lib/a.dart', '/app'), 'lib/a.dart');
      expect(relativePath('/app/lib/a.dart', '/app/'), 'lib/a.dart');
      expect(relativePath(r'C:\app\lib\a.dart', r'C:\app'), 'lib/a.dart');
    });

    test('keeps paths outside the root, or when there is no root', () {
      expect(relativePath('/other/lib/a.dart', '/app'), '/other/lib/a.dart');
      expect(relativePath('lib/a.dart', ''), 'lib/a.dart');
    });
  });

  group('parseLcov', () {
    test('reads line hits per file', () {
      final lcov = parseLcov(record('lib/a.dart', {1: 2, 2: 0}));
      expect(lcov, {
        'lib/a.dart': {1: 2, 2: 0},
      });
    });

    test('merges repeated records, keeping the higher count', () {
      final first = record('/r/lib/a.dart', {1: 0, 2: 1});
      final second = record('/r/lib/a.dart', {1: 3, 2: 0, 3: 0});
      final merged = parseLcov(first + second, root: '/r');
      expect(merged, {
        'lib/a.dart': {1: 3, 2: 1, 3: 0},
      });
    });

    test('ignores malformed and orphan DA lines', () {
      final source = [
        'DA:1,1',
        'SF:lib/a.dart',
        'DA:2',
        'DA:x,1',
        'DA:3,y',
        'DA:4,1,checksum',
        'end_of_record',
        'DA:5,1',
      ].join('\n');
      expect(parseLcov(source), {
        'lib/a.dart': {4: 1},
      });
    });
  });

  group('checkCoverage', () {
    test('passes at the threshold', () {
      // 24 of 25 lines hit: exactly 96%.
      final hits = {for (var line = 1; line <= 25; line++) line: 25 - line};
      final report = checkCoverage(
        lcov: {'lib/a.dart': hits},
        libFiles: ['lib/a.dart'],
      );
      expect(report.found, 25);
      expect(report.hit, 24);
      expect(report.percent, 96);
      expect(report.misses, {
        'lib/a.dart': [25],
      });
      expect(report.passed, isTrue);
      expect(report.problems, isEmpty);
    });

    test('fails below the threshold', () {
      final report = checkCoverage(
        lcov: {
          'lib/a.dart': {1: 1, 2: 0},
        },
        libFiles: ['lib/a.dart'],
      );
      expect(report.percent, 50);
      expect(report.passed, isFalse);
      expect(report.problems, ['line coverage 50.00% is below 96.0%']);
    });

    test('honours a custom threshold', () {
      final report = checkCoverage(
        lcov: {
          'lib/a.dart': {1: 1, 2: 0},
        },
        libFiles: ['lib/a.dart'],
        threshold: 50,
      );
      expect(report.passed, isTrue);
    });

    test('lists lib/ files absent from lcov as having no lines', () {
      final report = checkCoverage(
        lcov: {
          'lib/a.dart': {1: 1},
        },
        libFiles: ['lib/a.dart', 'lib/b.dart', 'lib/b.g.dart'],
      );
      expect(report.percent, 100);
      expect(report.withoutLines, ['lib/b.dart']);
      expect(report.passed, isTrue);
    });

    test('ignores generated files and files outside lib/', () {
      final report = checkCoverage(
        lcov: {
          'lib/a.dart': {1: 1},
          'lib/a.g.dart': {1: 0, 2: 0},
          'lib/a.freezed.dart': {1: 0},
          'test/helper.dart': {1: 0},
        },
        libFiles: ['lib/a.dart', 'lib/a.g.dart', 'lib/a.freezed.dart'],
      );
      expect(report.found, 1);
      expect(report.passed, isTrue);
    });

    test('fails when there is no line data', () {
      final report = checkCoverage(lcov: {}, libFiles: []);
      expect(report.percent, 0);
      expect(report.problems, ['coverage/lcov.info has no line data for lib/']);
    });
  });

  group('on disk', () {
    late Directory root;

    setUp(() {
      root = Directory.systemTemp.createTempSync('check_coverage_test');
    });

    tearDown(() {
      root.deleteSync(recursive: true);
    });

    void writeFile(String path, String contents) {
      File('${root.path}/$path')
        ..createSync(recursive: true)
        ..writeAsStringSync(contents);
    }

    test('dartFilesUnder lists .dart files, relative and sorted', () {
      writeFile('lib/src/b.dart', '');
      writeFile('lib/a.dart', '');
      writeFile('lib/notes.txt', '');
      expect(dartFilesUnder(root.path, 'lib'), [
        'lib/a.dart',
        'lib/src/b.dart',
      ]);
      expect(dartFilesUnder(root.path, 'missing'), isEmpty);
    });

    test('importAllSource imports every non-generated lib/ file', () {
      final source = importAllSource([
        'lib/main.dart',
        'lib/src/a.dart',
        'lib/src/a.g.dart',
      ]);
      expect(source, contains("import 'package:lectio/main.dart';"));
      expect(source, contains("import 'package:lectio/src/a.dart';"));
      expect(source, isNot(contains('a.g.dart')));
      expect(source, endsWith('void main() {}\n'));
    });

    test('prepare writes the import-all test', () {
      writeFile('lib/a.dart', '');
      final out = StringBuffer();
      expect(prepare(root.path, out: out), 0);
      final written = File('${root.path}/$importAllTest').readAsStringSync();
      expect(written, importAllSource(['lib/a.dart']));
      expect(out.toString(), contains('wrote $importAllTest'));
    });

    test('run fails when the import-all test is missing or stale', () {
      writeFile('lib/a.dart', '');
      final out = StringBuffer();
      final err = StringBuffer();
      expect(run(root.path, out: out, err: err), 1);
      expect(err.toString(), contains('is missing or stale'));

      prepare(root.path, out: out);
      writeFile('lib/b.dart', '');
      expect(run(root.path, out: out, err: err), 1);
    });

    test('run fails without coverage/lcov.info', () {
      prepare(root.path, out: StringBuffer());
      final out = StringBuffer();
      final err = StringBuffer();
      expect(run(root.path, out: out, err: err), 1);
      expect(err.toString(), contains('coverage/lcov.info not found'));
    });

    test('run passes and reports the total', () {
      final lcov = record('${root.path}/lib/a.dart', {1: 1, 2: 1});
      writeFile('lib/a.dart', '');
      writeFile('lib/constants.dart', '');
      writeFile('coverage/lcov.info', lcov);
      prepare(root.path, out: StringBuffer());
      final out = StringBuffer();
      final err = StringBuffer();
      expect(run(root.path, out: out, err: err), 0);
      expect(out.toString(), contains('100.00% (2/2 lines), minimum 96.0%'));
      expect(out.toString(), contains('lib/constants.dart: no executable'));
      expect(err.toString(), isEmpty);
    });

    test('run fails below the threshold and lists uncovered lines', () {
      writeFile('lib/a.dart', '');
      writeFile('coverage/lcov.info', record('lib/a.dart', {1: 1, 2: 0}));
      prepare(root.path, out: StringBuffer());
      final out = StringBuffer();
      final err = StringBuffer();
      expect(run(root.path, out: out, err: err), 1);
      expect(out.toString(), contains('lib/a.dart: uncovered lines 2'));
      expect(err.toString(), contains('is below 96.0%'));
    });
  });
}
