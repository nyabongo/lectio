import 'dart:io';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lectio/data/api_cache.dart';
import 'package:lectio/data/file_api_cache.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late Directory temp;
  late FileApiCache cache;
  final entry = CachedResponse(
    body: '{"greek":"ἀγαθός"}',
    fetchedAt: DateTime.utc(2026, 9, 20, 6),
    etag: '"v1"',
  );

  setUp(() {
    temp = Directory.systemTemp.createTempSync('lectio-cache-');
    cache = FileApiCache(Directory('${temp.path}/api-v1'));
  });

  tearDown(() => temp.deleteSync(recursive: true));

  test('a missing entry reads as null, before any write', () async {
    expect(await cache.read('index.json'), isNull);
  });

  test('writes and reads entries by path, across instances', () async {
    await cache.write('days/2026-09-20.json', entry);
    await cache.write('index.json', entry);
    final reopened = FileApiCache(cache.directory);
    final read = await reopened.read('days/2026-09-20.json');
    expect(read!.body, entry.body);
    expect(read.fetchedAt, entry.fetchedAt);
    expect(read.etag, '"v1"');
    expect(read.lastModified, isNull);
  });

  test('two instances can write the same path at once', () async {
    final other = FileApiCache(cache.directory);
    await Future.wait([
      for (var i = 0; i < 10; i++) ...[
        cache.write('index.json', entry),
        other.write('index.json', entry),
      ],
    ]);
    expect((await other.read('index.json'))!.body, entry.body);
    expect(cache.directory.listSync(), hasLength(1));
  });

  test('keeps one flat file per path and no temporary files', () async {
    await cache.write('days/2026-09-20.json', entry);
    await cache.write('days/2026-09-20.json', entry);
    final names = cache.directory
        .listSync()
        .map((file) => file.uri.pathSegments.last)
        .toList();
    expect(names, ['days%2F2026-09-20.json']);
  });

  test('an unreadable entry reads as null', () async {
    await cache.write('index.json', entry);
    File('${cache.directory.path}/index.json').writeAsStringSync('{broken');
    expect(await cache.read('index.json'), isNull);
  });

  test('inSupportDirectory uses the app support directory', () async {
    const channel = MethodChannel('plugins.flutter.io/path_provider');
    final messenger =
        TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          ..setMockMethodCallHandler(channel, (call) async => temp.path);
    addTearDown(() => messenger.setMockMethodCallHandler(channel, null));

    final support = await FileApiCache.inSupportDirectory();
    expect(support.directory.path, '${temp.path}/api-v1');
  });
}
