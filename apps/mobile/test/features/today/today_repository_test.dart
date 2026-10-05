import 'package:flutter_test/flutter_test.dart';
import 'package:lectio/data/data.dart';
import 'package:lectio/features/today/today_repository.dart';

import '../../data/fake_api.dart';

void main() {
  group('LazyApiCache', () {
    test('opens the backing cache once, on first use', () async {
      final backing = MemoryApiCache();
      var opens = 0;
      final cache = LazyApiCache(() async {
        opens++;
        return backing;
      });
      expect(opens, 0);

      expect(await cache.read('index.json'), isNull);
      final entry = CachedResponse(body: '{}', fetchedAt: DateTime(2026));
      await cache.write('index.json', entry);

      expect(opens, 1);
      expect(backing.paths, ['index.json']);
      expect((await cache.read('index.json'))?.body, '{}');
    });

    test('fails reads and writes when the cache cannot open', () async {
      final cache = LazyApiCache(
        () async => throw const FileSystemLikeException(),
      );
      final entry = CachedResponse(body: '{}', fetchedAt: DateTime(2026));

      await expectLater(
        cache.read('index.json'),
        throwsA(isA<FileSystemLikeException>()),
      );
      await expectLater(
        cache.write('index.json', entry),
        throwsA(isA<FileSystemLikeException>()),
      );
    });
  });

  group('createLectioRepository', () {
    test('reads through the given client and cache', () async {
      final api = FakeApi()..serveFixture('index.json', 'index');
      final backing = MemoryApiCache();
      final repository = createLectioRepository(
        httpClient: api.client,
        openCache: () async => backing,
      );

      // The default base URL is production; the fake answers any host.
      final index = await repository.watchIndex().last;

      expect(index.value.buildDate, '2026-09-20');
      expect(backing.paths, ['index.json']);
    });

    test('builds with the default client and cache', () {
      expect(createLectioRepository(), isA<LectioRepository>());
    });
  });

  group('todayRepository', () {
    tearDown(() => todayRepository = null);

    test('is built once and can be replaced', () {
      final first = todayRepository;
      expect(todayRepository, same(first));

      final replacement = createLectioRepository(
        openCache: () async => MemoryApiCache(),
      );
      todayRepository = replacement;
      expect(todayRepository, same(replacement));

      todayRepository = null;
      expect(todayRepository, isNot(same(replacement)));
    });
  });
}

/// What a failing cache throws.
class FileSystemLikeException implements Exception {
  /// Creates the exception.
  const new();
}
