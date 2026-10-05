import 'package:flutter_test/flutter_test.dart';
import 'package:lectio/data/data.dart';

import 'fake_api.dart';
import 'fixtures.dart';

void main() {
  group('apiLocaleFor', () {
    test('reads the sw mirror for Kiswahili', () {
      expect(apiLocaleFor('sw'), 'sw');
    });

    test('reads the API root for English and anything else', () {
      expect(apiLocaleFor('en'), defaultApiLocale);
      expect(apiLocaleFor('fr'), defaultApiLocale);
      expect(apiLocaleFor(null), defaultApiLocale);
    });
  });

  group('localizedPath', () {
    test('prefixes the locale outside the default one', () {
      expect(
        localizedPath(dayPath('2026-09-20'), 'sw'),
        'sw/days/2026-09-20.json',
      );
      expect(localizedPath(upcomingPath, 'sw'), 'sw/upcoming.json');
    });

    test('keeps the default locale and index.json at the root', () {
      expect(localizedPath(upcomingPath, 'en'), upcomingPath);
      expect(localizedPath(indexPath, 'sw'), indexPath);
    });
  });

  group('LectioRepository.forLocale', () {
    late FakeApi api;
    late LectioRepository repository;

    setUp(() {
      api = FakeApi();
      repository = LectioRepository(
        client: ApiClient(httpClient: api.client, baseUrl: FakeApi.baseUrl),
        cache: MemoryApiCache(),
        clock: () => DateTime(2026, 9, 20, 7),
        freshFor: const Duration(minutes: 5),
      );
    });

    test('gives one repository per locale, the root for English', () {
      final sw = repository.forLocale('sw');
      expect(repository.locale, 'en');
      expect(sw.locale, 'sw');
      expect(sw.freshFor, const Duration(minutes: 5));
      expect(identical(repository.forLocale('sw'), sw), isTrue);
      expect(identical(sw.forLocale('sw'), sw), isTrue);
      expect(identical(sw.forLocale('en'), repository), isTrue);
      expect(identical(repository.forLocale('en'), repository), isTrue);
    });

    test('reads the mirror, and index.json from the root', () async {
      api
        ..serveFixture('sw/days/2026-09-20.json', 'day')
        ..serveFixture('index.json', 'index');
      final sw = repository.forLocale('sw');

      final day = await sw.watchToday().last;
      final index = await sw.watchIndex().last;

      expect(day.value.date, '2026-09-20');
      expect(index.value.locales, ['en']);
      expect(api.paths, ['sw/days/2026-09-20.json', 'index.json']);
    });

    test('keeps each locale in its own cache entries', () async {
      api
        ..serveFixture('days/2026-09-20.json', 'day')
        ..serveFixture('sw/days/2026-09-20.json', 'day');

      await repository.watchDay('2026-09-20').last;
      await repository.forLocale('sw').watchDay('2026-09-20').last;
      // Both are now fresh in the cache: neither asks the network again.
      await repository.watchDay('2026-09-20').last;
      await repository.forLocale('sw').watchDay('2026-09-20').last;

      expect(api.paths, ['days/2026-09-20.json', 'sw/days/2026-09-20.json']);
    });
  });

  group('Celebration names', () {
    Celebration celebration(Map<String, Object?>? names) {
      return Celebration.fromJson({
        'id': 'ordinary-time-25-sunday',
        'name': 'Twenty-fifth Sunday in Ordinary Time',
        'rank': 'sunday',
        'colour': 'green',
        'names': ?names,
      });
    }

    test('reads names with their Kiswahili status', () {
      final names = celebration({
        'en': 'Twenty-fifth Sunday in Ordinary Time',
        'sw': 'Dominika ya 25 ya Mwaka',
        'swStatus': 'provisional',
      }).names!;
      expect(names.en, 'Twenty-fifth Sunday in Ordinary Time');
      expect(names.sw, 'Dominika ya 25 ya Mwaka');
      expect(names.swStatus, 'provisional');
    });

    test('nameIn gives the Kiswahili name unless it is a fallback', () {
      final named = celebration({
        'en': 'Twenty-fifth Sunday in Ordinary Time',
        'sw': 'Dominika ya 25 ya Mwaka',
      });
      expect(named.nameIn('sw'), (
        text: 'Dominika ya 25 ya Mwaka',
        language: 'sw',
      ));
      expect(named.nameIn('en'), (
        text: 'Twenty-fifth Sunday in Ordinary Time',
        language: 'en',
      ));

      final fallback = celebration({
        'en': 'Twenty-fifth Sunday in Ordinary Time',
        'sw': 'Twenty-fifth Sunday in Ordinary Time',
        'swStatus': 'fallback',
      });
      expect(fallback.nameIn('sw').language, 'en');
    });

    test('a day without names shows the English name', () {
      final day = parseApiDay(fixtureJson('day'));
      final principal = day.celebrations.first;
      expect(principal.names, isNull);
      expect(principal.nameIn('sw'), (
        text: 'Twenty-fifth Sunday in Ordinary Time',
        language: 'en',
      ));
    });
  });
}
