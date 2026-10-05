import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:lectio/data/api_client.dart';
import 'package:lectio/data/api_exceptions.dart';

import 'fake_api.dart';

void main() {
  late FakeApi api;
  late ApiClient client;

  setUp(() {
    api = FakeApi();
    client = ApiClient(httpClient: api.client, baseUrl: FakeApi.baseUrl);
  });

  group('base URL', () {
    test('defaults to the production API', () {
      final production = ApiClient(httpClient: api.client);
      expect(defaultApiBaseUrl, 'https://nyabongo.github.io/lectio/api/v1/');
      expect(production.baseUrl, Uri.parse(defaultApiBaseUrl));
      expect(production.timeout, const Duration(seconds: 20));
    });

    test('gains a trailing slash, so paths resolve under it', () {
      final bare = ApiClient(
        httpClient: api.client,
        baseUrl: Uri.parse('https://api.test/lectio/api/v1'),
      );
      expect(bare.baseUrl.path, '/lectio/api/v1/');
      expect(
        bare.resolve('days/2026-09-20.json'),
        Uri.parse('https://api.test/lectio/api/v1/days/2026-09-20.json'),
      );
    });
  });

  group('get', () {
    test('returns the body decoded as UTF-8 and the validators', () async {
      api.serve('index.json', '{"greek":"ἀγαθός"}', etag: '"v1"');
      final response = await client.get('index.json');
      expect(response.body, '{"greek":"ἀγαθός"}');
      expect(response.etag, '"v1"');
      expect(response.lastModified, isNull);
      expect(api.requests.single.headers['Accept'], 'application/json');
      expect(api.requests.single.headers['If-None-Match'], isNull);
    });

    test('sends a conditional request and reads 304 as unchanged', () async {
      api.serve('index.json', '{}', etag: '"v1"');
      final response = await client.get(
        'index.json',
        etag: '"v1"',
        lastModified: 'Sun, 20 Sep 2026 00:00:00 GMT',
      );
      expect(response.body, isNull);
      expect(response.etag, '"v1"');
      expect(response.lastModified, 'Sun, 20 Sep 2026 00:00:00 GMT');
      final headers = api.requests.single.headers;
      expect(headers['If-None-Match'], '"v1"');
      expect(headers['If-Modified-Since'], 'Sun, 20 Sep 2026 00:00:00 GMT');
    });

    test('takes new validators from a 304', () async {
      final mock = MockClient(
        (request) async => http.Response(
          '',
          304,
          headers: {'etag': '"v2"', 'last-modified': 'Mon'},
        ),
      );
      final response = await ApiClient(httpClient: mock)
          .get('index.json', lastModified: 'Sun');
      expect(response.body, isNull);
      expect(response.etag, '"v2"');
      expect(response.lastModified, 'Mon');
    });

    test('a 304 to an unconditional request is an error', () async {
      api.status = 304;
      await expectLater(
        client.get('index.json'),
        throwsA(
          isA<ApiStatusException>().having(
            (e) => e.statusCode,
            'statusCode',
            304,
          ),
        ),
      );
    });

    test('404 is not found', () async {
      await expectLater(
        client.get('days/2026-01-01.json'),
        throwsA(
          isA<ApiNotFoundException>().having(
            (e) => e.uri,
            'uri',
            FakeApi.baseUrl.resolve('days/2026-01-01.json'),
          ),
        ),
      );
    });

    test('other statuses are errors', () async {
      api.status = 500;
      await expectLater(
        client.get('index.json'),
        throwsA(isA<ApiStatusException>()),
      );
      api.status = 199;
      await expectLater(
        client.get('index.json'),
        throwsA(isA<ApiStatusException>()),
      );
    });

    test('a failing client is a network error', () async {
      api.offline = true;
      await expectLater(
        client.get('index.json'),
        throwsA(
          isA<ApiNetworkException>().having(
            (e) => e.cause,
            'cause',
            isA<http.ClientException>(),
          ),
        ),
      );
    });

    test('a slow server times out as a network error', () async {
      final never = MockClient((request) => Completer<http.Response>().future);
      final slow = ApiClient(
        httpClient: never,
        timeout: const Duration(milliseconds: 1),
      );
      await expectLater(
        slow.get('index.json'),
        throwsA(
          isA<ApiNetworkException>().having(
            (e) => e.cause,
            'cause',
            isA<TimeoutException>(),
          ),
        ),
      );
    });
  });

  group('typed fetches', () {
    test('read each document from its path', () async {
      api
        ..serveFixture('index.json', 'index')
        ..serveFixture('days/2026-09-20.json', 'day')
        ..serveFixture('passages/MT.20.1-16.json', 'passage')
        ..serveFixture('passages/index.json', 'passage-index')
        ..serveFixture('calendar/2026.json', 'calendar')
        ..serveFixture('upcoming.json', 'upcoming');

      expect((await client.fetchIndex()).buildDate, '2026-09-20');
      expect((await client.fetchDay('2026-09-20')).date, '2026-09-20');
      final passage = await client.fetchPassage('MT.20.1-16');
      expect(passage.passage.key, 'MT.20.1-16');
      final passages = await client.fetchPassageIndex();
      expect(passages.passages, hasLength(1));
      expect((await client.fetchCalendar(2026)).year, 2026);
      expect((await client.fetchUpcoming()).from, '2026-09-20');
      expect(api.paths, [
        'index.json',
        'days/2026-09-20.json',
        'passages/MT.20.1-16.json',
        'passages/index.json',
        'calendar/2026.json',
        'upcoming.json',
      ]);
    });

    test('a malformed document is a FormatException', () async {
      api.serve('index.json', '{"apiVersion": 1}');
      await expectLater(client.fetchIndex(), throwsFormatException);
      api.serve('upcoming.json', 'not json');
      await expectLater(client.fetchUpcoming(), throwsFormatException);
    });
  });
}
