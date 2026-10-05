import 'package:flutter_test/flutter_test.dart';
import 'package:lectio/data/api_cache.dart';

void main() {
  final fetchedAt = DateTime.utc(2026, 9, 20, 6);

  group('CachedResponse', () {
    test('round-trips through JSON', () {
      final entry = CachedResponse(
        body: '{"a":1}',
        fetchedAt: fetchedAt,
        etag: '"v1"',
        lastModified: 'Sun, 20 Sep 2026 06:00:00 GMT',
      );
      final copy = CachedResponse.fromJson(entry.toJson());
      expect(copy.body, entry.body);
      expect(copy.fetchedAt, fetchedAt);
      expect(copy.etag, '"v1"');
      expect(copy.lastModified, 'Sun, 20 Sep 2026 06:00:00 GMT');
    });

    test('stores the fetch time in UTC', () {
      final local = DateTime(2026, 9, 20, 9);
      final entry = CachedResponse(body: '', fetchedAt: local);
      expect(entry.toJson()['fetchedAt'], local.toUtc().toIso8601String());
      expect(entry.toJson()['etag'], isNull);
    });

    test('rejects malformed entries', () {
      expect(() => CachedResponse.fromJson('x'), throwsFormatException);
      expect(
        () => CachedResponse.fromJson({'body': '', 'fetchedAt': 'soon'}),
        throwsFormatException,
      );
    });

    test('revalidated keeps the body and takes new validators', () {
      final entry = CachedResponse(
        body: 'b',
        fetchedAt: fetchedAt,
        etag: '"v1"',
        lastModified: 'old',
      );
      final later = fetchedAt.add(const Duration(hours: 1));
      final same = entry.revalidated(at: later);
      expect(same.body, 'b');
      expect(same.fetchedAt, later);
      expect(same.etag, '"v1"');
      expect(same.lastModified, 'old');
      final updated = entry.revalidated(
        at: later,
        etag: '"v2"',
        lastModified: 'new',
      );
      expect(updated.etag, '"v2"');
      expect(updated.lastModified, 'new');
    });
  });

  test('MemoryApiCache stores entries by path', () async {
    final cache = MemoryApiCache();
    expect(await cache.read('index.json'), isNull);
    final entry = CachedResponse(body: '{}', fetchedAt: fetchedAt);
    await cache.write('index.json', entry);
    expect(await cache.read('index.json'), same(entry));
    expect(cache.paths, ['index.json']);
  });
}
