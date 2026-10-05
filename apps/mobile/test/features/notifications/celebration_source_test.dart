import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:lectio/data/api_cache.dart';
import 'package:lectio/data/api_client.dart';
import 'package:lectio/data/repository.dart';
import 'package:lectio/features/notifications/celebration_source.dart';

import '../../data/fake_api.dart';
import '../../data/fixtures.dart';

void main() {
  late FakeApi api;
  late RepositoryCelebrations celebrations;

  setUp(() {
    api = FakeApi();
    celebrations = RepositoryCelebrations(
      LectioRepository(
        client: ApiClient(httpClient: api.client, baseUrl: FakeApi.baseUrl),
        cache: MemoryApiCache(),
        clock: () => DateTime(2026, 9, 20, 7),
      ),
    );
  });

  test('names the main celebration of the day', () async {
    api.serveFixture('days/2026-09-20.json', 'day');
    expect(
      await celebrations.celebrationOn('2026-09-20'),
      'Twenty-fifth Sunday in Ordinary Time',
    );
  });

  test('uses the cached day without asking the network again', () async {
    api.serveFixture('days/2026-09-20.json', 'day');
    await celebrations.celebrationOn('2026-09-20');
    api.offline = true;
    expect(
      await celebrations.celebrationOn('2026-09-20'),
      'Twenty-fifth Sunday in Ordinary Time',
    );
    expect(api.paths, ['days/2026-09-20.json']);
  });

  test('is unknown for a day without celebrations', () async {
    final day = fixtureObject('day')..['celebrations'] = <Object?>[];
    api.serve('days/2026-09-20.json', jsonEncode(day));
    expect(await celebrations.celebrationOn('2026-09-20'), isNull);
  });

  test('is unknown for a day that cannot be read', () async {
    expect(await celebrations.celebrationOn('2026-09-21'), isNull);
    api.offline = true;
    expect(await celebrations.celebrationOn('2026-09-22'), isNull);
  });
}
