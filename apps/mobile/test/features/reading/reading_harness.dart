import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:lectio/data/api_cache.dart';
import 'package:lectio/data/api_client.dart';
import 'package:lectio/data/repository.dart';
import 'package:lectio/features/reading/reading_scope.dart';

import '../../data/fake_api.dart';
import '../../data/fixtures.dart';

/// The day the seed fixture describes.
const String seedDate = '2026-09-20';

/// The API path of the seed day.
const String seedDayPath = 'days/2026-09-20.json';

/// A Hebrew word for the Hebrew note (an original-language word, not
/// reading text).
const String hebrewWord = 'חֶסֶד';

/// A Hebrew excerpt for a source.
const String hebrewExcerpt = 'רָעָה עֵינְךָ';

/// The seed day document (`test/fixtures/day.json`), decoded for editing.
Map<String, Object?> seedDay() => fixtureObject('day');

/// The readings of the first Mass of [day].
List<Object?> readingsOf(Map<String, Object?> day) {
  final masses = day['masses']! as List<Object?>;
  final mass = masses.first! as Map<String, Object?>;
  return mass['readings']! as List<Object?>;
}

/// The Gospel passage of [day] (the last reading of the seed day).
Map<String, Object?> gospelOf(Map<String, Object?> day) {
  final gospel = readingsOf(day).last! as Map<String, Object?>;
  return gospel['passage']! as Map<String, Object?>;
}

/// The seed day with a Hebrew translation note and a Hebrew source excerpt.
Map<String, Object?> hebrewDay() {
  final day = seedDay();
  final passage = gospelOf(day);
  (passage['translationNotes']! as List<Object?>).insert(0, {
    'id': 'v8-hesed',
    'verse': '20:8',
    'anchor': 'kindness',
    'original': {
      'text': hebrewWord,
      'lang': 'hbo',
      'translit': 'ḥesed',
      'gloss': 'covenant loyalty',
    },
    'summary': 'A test note on a Hebrew word.',
    'body': 'The idiom echoes $hebrewWord [c3]',
    'audio': null,
  });
  final sources = passage['sources']! as List<Object?>;
  for (final item in sources) {
    final source = item! as Map<String, Object?>;
    if (source['id'] == 'dt-15-9') {
      source
        ..['excerpt'] = hebrewExcerpt
        ..['excerptLang'] = 'hbo';
    }
  }
  return day;
}

/// The reference of the Vigil Gospel in [vigilDay].
const String vigilGospelRef = 'Mt 1:1-25';

/// The seed day with a Vigil Mass before the Mass of the day that has only a
/// Gospel, as on Easter or Christmas.
Map<String, Object?> vigilDay() {
  final day = seedDay();
  (day['masses']! as List<Object?>).insert(0, {
    'id': 'vigil',
    'label': 'Vigil Mass',
    'readings': [
      {
        'slot': 'gospel',
        'ref': vigilGospelRef,
        'key': 'MT.1.1-25',
        'linkout': 'https://www.drbo.org/chapter/47001.htm',
        'passage': null,
      },
    ],
  });
  return day;
}

/// A fake API, an in-memory cache and a recording link launcher around the
/// Reading screen.
class ReadingHarness {
  /// The fake API host.
  final FakeApi api = FakeApi();

  /// The offline cache.
  final MemoryApiCache cache = MemoryApiCache();

  /// Every link the screen opened.
  final List<Uri> launched = [];

  /// What the launcher answers.
  bool launchResult = true;

  /// Whether the launcher throws instead of answering.
  bool launchThrows = false;

  /// The device time.
  DateTime now = DateTime(2026, 9, 20, 7);

  /// The repository the screen reads.
  late final LectioRepository repository = LectioRepository(
    client: ApiClient(httpClient: api.client, baseUrl: FakeApi.baseUrl),
    cache: cache,
    clock: () => now,
  );

  /// Serves the seed day.
  void serveSeedDay() => api.serveFixture(seedDayPath, 'day');

  /// Serves [day] as the seed date.
  void serveDay(Map<String, Object?> day) {
    api.serve(seedDayPath, jsonEncode(day));
  }

  /// The launcher passed to [ReadingScope].
  Future<bool> launch(Uri url) async {
    launched.add(url);
    if (launchThrows) throw const FormatException('cannot launch');
    return launchResult;
  }

  /// [child] in an app with this harness's scope.
  Widget wrap(Widget child) {
    return ReadingScope(
      repository: repository,
      launchLink: launch,
      child: MaterialApp(home: Scaffold(body: child)),
    );
  }
}
