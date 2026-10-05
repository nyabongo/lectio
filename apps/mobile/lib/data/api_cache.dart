import 'package:lectio/data/json.dart';

/// A document kept for offline use, with what is needed to revalidate it.
class CachedResponse {
  /// Creates a cache entry.
  const new({
    required this.body,
    required this.fetchedAt,
    this.etag,
    this.lastModified,
  });

  /// Reads an entry written by [toJson].
  factory fromJson(Object? json) {
    final object = asJsonObject(json, 'cache entry');
    return CachedResponse(
      body: object.string('body'),
      fetchedAt: DateTime.parse(object.string('fetchedAt')),
      etag: object.optionalString('etag'),
      lastModified: object.optionalString('lastModified'),
    );
  }

  /// The document text as the server sent it.
  final String body;

  /// When the document was last fetched or confirmed unchanged.
  final DateTime fetchedAt;

  /// The `ETag` header of the response.
  final String? etag;

  /// The `Last-Modified` header of the response.
  final String? lastModified;

  /// This entry, confirmed unchanged at [at] with the validators of the
  /// not-modified response (kept when the response has none).
  CachedResponse revalidated({
    required DateTime at,
    String? etag,
    String? lastModified,
  }) {
    return CachedResponse(
      body: body,
      fetchedAt: at,
      etag: etag ?? this.etag,
      lastModified: lastModified ?? this.lastModified,
    );
  }

  /// The entry as JSON, for [CachedResponse.fromJson].
  JsonObject toJson() => {
    'body': body,
    'fetchedAt': fetchedAt.toUtc().toIso8601String(),
    'etag': etag,
    'lastModified': lastModified,
  };
}

/// Where API documents are kept between launches, keyed by API path.
abstract interface class ApiCache {
  /// The entry for [path], or `null` when there is none or it is unreadable.
  Future<CachedResponse?> read(String path);

  /// Stores [entry] for [path], replacing any earlier one.
  Future<void> write(String path, CachedResponse entry);
}

/// An [ApiCache] in memory, lost when the app stops.
class MemoryApiCache implements ApiCache {
  final Map<String, CachedResponse> _entries = {};

  /// The paths with an entry.
  Iterable<String> get paths => _entries.keys;

  @override
  Future<CachedResponse?> read(String path) async => _entries[path];

  @override
  Future<void> write(String path, CachedResponse entry) async {
    _entries[path] = entry;
  }
}
