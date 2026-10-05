/// The app's data layer (L-101): API v1 models, the HTTP client, the offline
/// cache and the offline-first repository.
///
/// Wire it up once at start-up:
///
/// ```dart
/// final repository = LectioRepository(
///   client: ApiClient(httpClient: http.Client()),
///   cache: await FileApiCache.inSupportDirectory(),
/// );
/// unawaited(repository.prefetch());
/// repository.watchToday().listen(...);
/// ```
///
/// The API root comes from `--dart-define=LECTIO_API_BASE_URL=…`
/// (default: production).
library;

export 'package:lectio/data/api_cache.dart';
export 'package:lectio/data/api_client.dart';
export 'package:lectio/data/api_exceptions.dart';
export 'package:lectio/data/api_paths.dart';
export 'package:lectio/data/dates.dart';
export 'package:lectio/data/file_api_cache.dart';
export 'package:lectio/data/json.dart';
export 'package:lectio/data/models/day.dart';
export 'package:lectio/data/models/documents.dart';
export 'package:lectio/data/models/notes.dart';
export 'package:lectio/data/repository.dart';
