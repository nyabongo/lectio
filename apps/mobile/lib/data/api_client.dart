import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:lectio/data/api_exceptions.dart';
import 'package:lectio/data/api_paths.dart';
import 'package:lectio/data/models/day.dart';
import 'package:lectio/data/models/documents.dart';

/// The API root this build reads, set with
/// `--dart-define=LECTIO_API_BASE_URL=https://…/api/v1/`.
///
/// Defaults to the production site.
const String defaultApiBaseUrl = String.fromEnvironment(
  'LECTIO_API_BASE_URL',
  defaultValue: 'https://nyabongo.github.io/lectio/api/v1/',
);

/// A successful answer: a document, or "not modified" (HTTP 304).
class ApiResponse {
  /// Creates a response. A `null` [body] means "not modified".
  const new({this.body, this.etag, this.lastModified});

  /// The document text, or `null` when the server answered 304.
  final String? body;

  /// The `ETag` header, for the next conditional request.
  final String? etag;

  /// The `Last-Modified` header, for the next conditional request.
  final String? lastModified;
}

/// Reads the static JSON API v1 (docs/api.md) over an injected HTTP client.
///
/// Tests pass a fake `http.Client`, so they never touch the network.
class ApiClient {
  /// Creates a client for the API at [baseUrl] (default
  /// [defaultApiBaseUrl]), sending requests through [httpClient].
  new({
    required http.Client httpClient,
    Uri? baseUrl,
    this.timeout = const Duration(seconds: 20),
  }) : _http = httpClient,
       baseUrl = _directory(baseUrl ?? Uri.parse(defaultApiBaseUrl));

  final http.Client _http;

  /// The API root, always ending in `/`.
  final Uri baseUrl;

  /// How long one request may take before it counts as a network failure.
  final Duration timeout;

  /// The absolute URL of the document at [path].
  Uri resolve(String path) => baseUrl.resolve(path);

  /// Fetches the document at [path].
  ///
  /// With [etag] or [lastModified] from an earlier response, the request is
  /// conditional and an unchanged document comes back with a `null` body.
  /// Throws an [ApiException] when the document cannot be fetched.
  Future<ApiResponse> get(
    String path, {
    String? etag,
    String? lastModified,
  }) async {
    final uri = resolve(path);
    final conditional = etag != null || lastModified != null;
    final http.Response response;
    try {
      response = await _http
          .get(
            uri,
            headers: {
              'Accept': 'application/json',
              'If-None-Match': ?etag,
              'If-Modified-Since': ?lastModified,
            },
          )
          .timeout(timeout);
    } on Exception catch (error) {
      throw ApiNetworkException(uri, error);
    }
    final status = response.statusCode;
    final headers = response.headers;
    if (status == 304 && conditional) {
      return ApiResponse(
        etag: headers['etag'] ?? etag,
        lastModified: headers['last-modified'] ?? lastModified,
      );
    }
    if (status == 404) throw ApiNotFoundException(uri);
    if (status < 200 || status > 299) throw ApiStatusException(uri, status);
    return ApiResponse(
      // Static hosts often omit the charset; API documents are UTF-8.
      body: utf8.decode(response.bodyBytes),
      etag: headers['etag'],
      lastModified: headers['last-modified'],
    );
  }

  Future<Object?> _document(String path) async {
    final response = await get(path);
    return jsonDecode(response.body!);
  }

  /// Fetches `index.json`.
  Future<ApiIndex> fetchIndex() async {
    return ApiIndex.fromJson(await _document(indexPath));
  }

  /// Fetches `days/{date}.json` for the ISO [date].
  Future<ApiDay> fetchDay(String date) async {
    return parseApiDay(await _document(dayPath(date)));
  }

  /// Fetches `passages/{key}.json`.
  Future<ApiPassage> fetchPassage(String key) async {
    return ApiPassage.fromJson(await _document(passagePath(key)));
  }

  /// Fetches `passages/index.json`.
  Future<PassageIndex> fetchPassageIndex() async {
    return PassageIndex.fromJson(await _document(passageIndexPath));
  }

  /// Fetches `calendar/{year}.json`.
  Future<ApiCalendar> fetchCalendar(int year) async {
    return ApiCalendar.fromJson(await _document(calendarPath(year)));
  }

  /// Fetches `upcoming.json`.
  Future<ApiUpcoming> fetchUpcoming() async {
    return ApiUpcoming.fromJson(await _document(upcomingPath));
  }
}

Uri _directory(Uri url) {
  if (url.path.endsWith('/')) return url;
  return url.replace(path: '${url.path}/');
}
