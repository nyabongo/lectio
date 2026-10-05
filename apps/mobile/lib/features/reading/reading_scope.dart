import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:lectio/data/api_cache.dart';
import 'package:lectio/data/api_client.dart';
import 'package:lectio/data/file_api_cache.dart';
import 'package:lectio/data/repository.dart';
import 'package:lectio/features/reading/reading_strings.dart';
import 'package:url_launcher/url_launcher.dart';

/// Opens [url] outside the app; `false` when nothing can open it.
typedef LinkLauncher = Future<bool> Function(Uri url);

/// Launches a URL in a mode, as `url_launcher`'s `launchUrl` does.
typedef UrlLauncher = Future<bool> Function(Uri url, {LaunchMode mode});

/// Opens [url] in the browser or the app that handles it, through [launch]
/// (default: `launchUrl`).
Future<bool> launchExternally(Uri url, {UrlLauncher launch = launchUrl}) {
  return launch(url, mode: LaunchMode.externalApplication);
}

/// An [ApiCache] opened on first use, for a cache that is created
/// asynchronously (such as [FileApiCache.inSupportDirectory]).
///
/// When opening fails, every read and write fails with the same error, which
/// the repository treats as an empty cache.
class LazyApiCache implements ApiCache {
  /// Creates a cache that calls [_open] once, on first use.
  new(this._open);

  final Future<ApiCache> Function() _open;

  late final Future<ApiCache> _cache = _open();

  @override
  Future<CachedResponse?> read(String path) {
    return _cache.then((cache) => cache.read(path));
  }

  @override
  Future<void> write(String path, CachedResponse entry) async {
    final cache = await _cache;
    await cache.write(path, entry);
  }
}

LectioRepository? _defaultRepository;

/// The repository the Reading screen uses when no [ReadingScope] gives one:
/// the production API over HTTP, cached in the app's support directory.
LectioRepository defaultReadingRepository() {
  return _defaultRepository ??= LectioRepository(
    client: ApiClient(httpClient: http.Client()),
    cache: LazyApiCache(FileApiCache.inSupportDirectory),
  );
}

/// Gives the Reading screen its data and the way it opens links, so tests
/// pass fakes and the app can share one repository between features.
class ReadingScope extends InheritedWidget {
  /// Provides [repository] and [launchLink] to [child].
  const new({
    required this.repository,
    required super.child,
    this.launchLink = launchExternally,
    super.key,
  });

  /// Where day documents come from.
  final LectioRepository repository;

  /// How links (the reading text, sources, reports) are opened.
  final LinkLauncher launchLink;

  /// The nearest scope, or `null`.
  static ReadingScope? maybeOf(BuildContext context) {
    return context.dependOnInheritedWidgetOfExactType<ReadingScope>();
  }

  /// The repository of the nearest scope, else [defaultReadingRepository].
  static LectioRepository repositoryOf(BuildContext context) {
    return maybeOf(context)?.repository ?? defaultReadingRepository();
  }

  /// The launcher of the nearest scope, else [launchExternally].
  static LinkLauncher launcherOf(BuildContext context) {
    return maybeOf(context)?.launchLink ?? launchExternally;
  }

  @override
  bool updateShouldNotify(ReadingScope oldWidget) {
    return repository != oldWidget.repository ||
        launchLink != oldWidget.launchLink;
  }
}

/// Opens [url] with the scope's launcher, telling the reader when it cannot.
///
/// Only `https` links are opened (decision 001): links come from network or
/// cached JSON, so anything else (`http:`, `intent:`, `tel:`, `file:` …) is
/// refused like a link nothing can open.
Future<void> openLink(BuildContext context, Uri url) async {
  final launch = ReadingScope.launcherOf(context);
  final messenger = ScaffoldMessenger.maybeOf(context);
  var opened = false;
  if (url.scheme == 'https') {
    try {
      opened = await launch(url);
    } on Exception {
      opened = false;
    }
  }
  if (!opened) {
    messenger?.showSnackBar(
      SnackBar(content: Text(ReadingStrings.en.linkFailed)),
    );
  }
}
