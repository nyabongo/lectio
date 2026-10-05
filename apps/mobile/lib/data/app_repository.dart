import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:lectio/data/api_cache.dart';
import 'package:lectio/data/api_client.dart';
import 'package:lectio/data/file_api_cache.dart';
import 'package:lectio/data/repository.dart';

/// An [ApiCache] that opens the cache it delegates to on first use, so the
/// repository can be built synchronously while the on-disk cache needs the
/// platform's support directory.
///
/// When opening fails, every read and write fails with the same error, which
/// [LectioRepository] treats as an empty cache.
class LazyApiCache implements ApiCache {
  /// Creates a cache that calls [open] once, on the first read or write.
  new(Future<ApiCache> Function() open) : _open = open;

  final Future<ApiCache> Function() _open;
  Future<ApiCache>? _opened;

  Future<ApiCache> get _cache => _opened ??= _open();

  @override
  Future<CachedResponse?> read(String path) {
    return _cache.then((cache) => cache.read(path));
  }

  @override
  Future<void> write(String path, CachedResponse entry) async {
    await (await _cache).write(path, entry);
  }
}

/// The app's repository: the API through [httpClient] (default: a new
/// `http.Client`) and documents kept in the cache from [openCache] (default:
/// [FileApiCache.inSupportDirectory]).
LectioRepository createLectioRepository({
  http.Client? httpClient,
  Future<ApiCache> Function()? openCache,
}) {
  return LectioRepository(
    client: ApiClient(httpClient: httpClient ?? http.Client()),
    cache: LazyApiCache(openCache ?? FileApiCache.inSupportDirectory),
  );
}

LectioRepository? _appRepository;

/// The repository every screen reads when it is given none, built on first
/// use with [createLectioRepository].
LectioRepository get appRepository {
  return _appRepository ??= createLectioRepository();
}

/// Replaces the shared repository, for example with one over a fake API in
/// tests; `null` builds a new default one on next use.
@visibleForTesting
set appRepository(LectioRepository? repository) {
  _appRepository = repository;
}
