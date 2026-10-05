import 'package:flutter_test/flutter_test.dart';
import 'package:lectio/data/api_cache.dart';
import 'package:lectio/data/api_client.dart';
import 'package:lectio/data/api_exceptions.dart';
import 'package:lectio/data/repository.dart';

import 'fake_api.dart';
import 'fixtures.dart';

/// A cache whose reads or writes fail, like a full or corrupt disk.
class BrokenCache implements ApiCache {
  /// Creates a cache that fails on reads, writes or both.
  new({this.failReads = false, this.failWrites = false});

  /// Whether reads throw.
  final bool failReads;

  /// Whether writes throw.
  final bool failWrites;

  final MemoryApiCache _memory = MemoryApiCache();

  @override
  Future<CachedResponse?> read(String path) async {
    if (failReads) throw const FileSystemLikeException();
    return _memory.read(path);
  }

  @override
  Future<void> write(String path, CachedResponse entry) async {
    if (failWrites) throw const FileSystemLikeException();
    await _memory.write(path, entry);
  }
}

/// What [BrokenCache] throws.
class FileSystemLikeException implements Exception {
  /// Creates the exception.
  const new();
}

void main() {
  late FakeApi api;
  late MemoryApiCache cache;
  late DateTime now;
  late LectioRepository repository;

  LectioRepository repositoryWith(ApiCache cache) {
    return LectioRepository(
      client: ApiClient(httpClient: api.client, baseUrl: FakeApi.baseUrl),
      cache: cache,
      clock: () => now,
    );
  }

  setUp(() {
    api = FakeApi();
    cache = MemoryApiCache();
    now = DateTime(2026, 9, 20, 7);
    repository = repositoryWith(cache);
  });

  /// Fetches `days/2026-09-20.json` once so it is cached.
  Future<void> warmUp() async {
    await repository.watchDay('2026-09-20').drain<void>();
  }

  group('watch streams', () {
    test('with an empty cache, the network answers and fills the cache', () async {
      api.serveFixture('days/2026-09-20.json', 'day', etag: '"d1"');
      final snapshots = await repository.watchDay('2026-09-20').toList();
      expect(snapshots, hasLength(1));
      final snapshot = snapshots.single;
      expect(snapshot.origin, DataOrigin.network);
      expect(snapshot.value.date, '2026-09-20');
      expect(snapshot.fetchedAt, now);
      expect(snapshot.refreshError, isNull);
      final entry = await cache.read('days/2026-09-20.json');
      expect(entry!.etag, '"d1"');
      expect(entry.body, fixture('day'));
    });

    test('offline with an empty cache, the stream fails', () async {
      api.offline = true;
      await expectLater(
        repository.watchDay('2026-09-20').toList(),
        throwsA(isA<ApiNetworkException>()),
      );
    });

    test('a missing day fails with not found', () async {
      await expectLater(
        repository.watchDay('2026-01-01').toList(),
        throwsA(isA<ApiNotFoundException>()),
      );
    });

    test('a fresh cached day opens offline without a request', () async {
      api.serveFixture('days/2026-09-20.json', 'day');
      await warmUp();
      api.offline = true;
      now = now.add(const Duration(minutes: 5));
      final snapshots = await repository.watchDay('2026-09-20').toList();
      expect(snapshots.single.origin, DataOrigin.cache);
      expect(snapshots.single.value.date, '2026-09-20');
      expect(snapshots.single.fetchedAt, DateTime(2026, 9, 20, 7));
      expect(api.requests, hasLength(1));
    });

    test('a stale cached day is shown, then revalidated (304)', () async {
      api.serveFixture('days/2026-09-20.json', 'day', etag: '"d1"');
      await warmUp();
      now = now.add(const Duration(hours: 2));
      final snapshots = await repository.watchDay('2026-09-20').toList();
      expect(snapshots.map((s) => s.origin), [DataOrigin.cache]);
      expect(api.requests.last.headers['If-None-Match'], '"d1"');
      final entry = await cache.read('days/2026-09-20.json');
      expect(entry!.fetchedAt, now);
      expect(entry.etag, '"d1"');
    });

    test('a stale cached day is shown, then replaced when changed', () async {
      api.serveFixture('days/2026-09-20.json', 'day', etag: '"d1"');
      await warmUp();
      api.serveFixture('days/2026-09-20.json', 'day-with-audio', etag: '"d2"');
      now = now.add(const Duration(hours: 2));
      final snapshots = await repository.watchDay('2026-09-20').toList();
      expect(snapshots.map((s) => s.origin), [
        DataOrigin.cache,
        DataOrigin.network,
      ]);
      expect(snapshots.first.value.readings.last.passage!.context.audio, isNull);
      expect(
        snapshots.last.value.readings.last.passage!.context.audio,
        isNotNull,
      );
      final entry = await cache.read('days/2026-09-20.json');
      expect(entry!.etag, '"d2"');
    });

    test('refresh: true revalidates a fresh cached day', () async {
      api.serveFixture('days/2026-09-20.json', 'day', etag: '"d1"');
      await warmUp();
      await repository.watchDay('2026-09-20', refresh: true).drain<void>();
      expect(api.requests, hasLength(2));
    });

    test('offline with a stale cache: cached day, then the error', () async {
      api.serveFixture('days/2026-09-20.json', 'day');
      await warmUp();
      api.offline = true;
      now = now.add(const Duration(days: 1));
      final snapshots = await repository.watchDay('2026-09-20').toList();
      expect(snapshots, hasLength(2));
      expect(snapshots.first.refreshError, isNull);
      final last = snapshots.last;
      expect(last.origin, DataOrigin.cache);
      expect(last.value.date, '2026-09-20');
      expect(last.refreshError, isA<ApiNetworkException>());
    });

    test('a malformed update keeps the cached day', () async {
      api.serveFixture('days/2026-09-20.json', 'day');
      await warmUp();
      api.serve('days/2026-09-20.json', '{"apiVersion": 1}');
      final snapshots = await repository
          .watchDay('2026-09-20', refresh: true)
          .toList();
      expect(snapshots.last.refreshError, isA<FormatException>());
      final entry = await cache.read('days/2026-09-20.json');
      expect(entry!.body, fixture('day'));
    });

    test('an unreadable cache entry is fetched again', () async {
      await cache.write(
        'days/2026-09-20.json',
        CachedResponse(body: 'not json', fetchedAt: now),
      );
      api.serveFixture('days/2026-09-20.json', 'day');
      final snapshots = await repository.watchDay('2026-09-20').toList();
      expect(snapshots.single.origin, DataOrigin.network);
    });

    test('a failing cache never hides the network', () async {
      api.serveFixture('days/2026-09-20.json', 'day');
      final broken = repositoryWith(
        BrokenCache(failReads: true, failWrites: true),
      );
      final snapshots = await broken.watchDay('2026-09-20').toList();
      expect(snapshots.single.origin, DataOrigin.network);
    });

    test('watchToday reads the device date', () async {
      api.serveFixture('days/2026-09-20.json', 'day');
      now = DateTime(2026, 9, 20, 23, 59);
      final snapshot = await repository.watchToday().single;
      expect(snapshot.value.date, '2026-09-20');
    });

    test('every document has a stream', () async {
      api
        ..serveFixture('index.json', 'index')
        ..serveFixture('passages/MT.20.1-16.json', 'passage')
        ..serveFixture('passages/index.json', 'passage-index')
        ..serveFixture('calendar/2026.json', 'calendar')
        ..serveFixture('upcoming.json', 'upcoming');
      final index = await repository.watchIndex().single;
      expect(index.value.passageCount, 1);
      final passage = await repository.watchPassage('MT.20.1-16').single;
      expect(passage.value.passage.key, 'MT.20.1-16');
      final passages = await repository.watchPassageIndex().single;
      expect(passages.value.passages, hasLength(1));
      final calendar = await repository.watchCalendar(2026).single;
      expect(calendar.value.year, 2026);
      final upcoming = await repository.watchUpcoming().single;
      expect(upcoming.value.days, hasLength(2));
      expect(cache.paths, hasLength(5));
    });

    test('the default clock and freshness', () {
      final plain = LectioRepository(
        client: ApiClient(httpClient: api.client),
        cache: cache,
      );
      expect(plain.freshFor, const Duration(minutes: 15));
    });
  });

  group('prefetch', () {
    setUp(() {
      // index.json says days exist from 2026-09-19 to 2026-09-21.
      api
        ..serveFixture('index.json', 'index')
        ..serveFixture('days/2026-09-20.json', 'day')
        ..serveFixture('days/2026-09-21.json', 'day');
    });

    test('caches the next seven days the index publishes', () async {
      final report = await repository.prefetch();
      expect(report.fetched, ['2026-09-20', '2026-09-21']);
      expect(report.upToDate, isEmpty);
      expect(report.failed, isEmpty);
      expect(report.unavailable, [
        '2026-09-22',
        '2026-09-23',
        '2026-09-24',
        '2026-09-25',
        '2026-09-26',
      ]);
      expect(api.paths, [
        'index.json',
        'days/2026-09-20.json',
        'days/2026-09-21.json',
      ]);

      // Offline afterwards, both days still open.
      api.offline = true;
      now = now.add(const Duration(days: 1));
      final day = await repository.watchDay('2026-09-21').first;
      expect(day.origin, DataOrigin.cache);
    });

    test('skips fresh days and revalidates stale ones', () async {
      await repository.prefetch(days: 1);
      final again = await repository.prefetch(days: 2);
      expect(again.upToDate, ['2026-09-20']);
      expect(again.fetched, ['2026-09-21']);
      now = now.add(const Duration(hours: 1));
      final stale = await repository.prefetch(days: 1);
      expect(stale.fetched, ['2026-09-20']);
    });

    test('a gap inside the published range is unavailable', () async {
      api.remove('days/2026-09-20.json');
      final report = await repository.prefetch(days: 2);
      expect(report.unavailable, ['2026-09-20']);
      expect(report.fetched, ['2026-09-21']);
    });

    test('an empty repository publishes no days', () async {
      api.serveFixture('index.json', 'index-empty');
      final report = await repository.prefetch(days: 3);
      expect(report.unavailable, hasLength(3));
      expect(api.paths, ['index.json']);
    });

    test('without the index, every date is tried', () async {
      api.remove('index.json');
      final report = await repository.prefetch(days: 3);
      expect(report.fetched, ['2026-09-20', '2026-09-21']);
      expect(report.unavailable, ['2026-09-22']);
    });

    test('offline, every date fails and nothing throws', () async {
      api.offline = true;
      final report = await repository.prefetch(days: 2);
      expect(report.failed, ['2026-09-20', '2026-09-21']);
      expect(report.fetched, isEmpty);
    });

    test('a malformed day fails that date only', () async {
      api.serve('days/2026-09-20.json', 'not json');
      final report = await repository.prefetch(days: 2);
      expect(report.failed, ['2026-09-20']);
      expect(report.fetched, ['2026-09-21']);
    });
  });
}
