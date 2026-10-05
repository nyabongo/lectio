import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'fixtures.dart';

/// A fake static host for API v1, behind an `http.Client`, so tests stay
/// offline.
///
/// It serves the documents registered with [serve], answers 404 for any
/// other path, honours `If-None-Match` with 304, and throws like a phone
/// without signal while [offline] is true.
class FakeApi {
  /// The API root the fake answers under.
  static final Uri baseUrl = Uri.parse('https://api.test/lectio/api/v1/');

  final Map<String, ({String body, String? etag})> _documents = {};

  /// Every request received, in order.
  final List<http.Request> requests = [];

  /// Whether requests fail as if there were no network.
  bool offline = false;

  /// A status to answer every request with instead of the documents.
  int? status;

  /// The client to pass to the code under test.
  late final http.Client client = MockClient(_handle);

  /// Serves [body] at [path] (relative to [baseUrl]) with an optional ETag.
  void serve(String path, String body, {String? etag}) {
    _documents[path] = (body: body, etag: etag);
  }

  /// Serves `test/fixtures/<name>.json` at [path].
  void serveFixture(String path, String name, {String? etag}) {
    serve(path, fixture(name), etag: etag);
  }

  /// Stops serving [path].
  void remove(String path) => _documents.remove(path);

  /// The API paths requested, in order.
  List<String> get paths => [for (final r in requests) _path(r.url)];

  String _path(Uri url) => url.path.substring(baseUrl.path.length);

  Future<http.Response> _handle(http.Request request) async {
    requests.add(request);
    if (offline) throw http.ClientException('offline', request.url);
    final forced = status;
    if (forced != null) return http.Response('', forced);
    final document = _documents[_path(request.url)];
    if (document == null) return http.Response('', 404);
    final etag = document.etag;
    final headers = {'etag': ?etag};
    if (etag != null && request.headers['If-None-Match'] == etag) {
      return http.Response('', 304, headers: headers);
    }
    // No charset, like many static hosts: the client must decode UTF-8.
    return http.Response.bytes(
      utf8.encode(document.body),
      200,
      headers: headers,
    );
  }
}
