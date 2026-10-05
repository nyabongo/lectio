import 'dart:convert';

import 'package:lectio/data/api_cache.dart';
import 'package:lectio/data/api_client.dart';
import 'package:lectio/data/api_exceptions.dart';
import 'package:lectio/data/api_paths.dart';
import 'package:lectio/data/dates.dart';
import 'package:lectio/data/models/day.dart';
import 'package:lectio/data/models/documents.dart';

/// Where a [DataSnapshot] came from.
enum DataOrigin {
  /// The offline cache.
  cache,

  /// A fresh response from the API.
  network,
}

/// A document as the repository last knew it.
class DataSnapshot<T> {
  /// Creates a snapshot.
  const new({
    required this.value,
    required this.origin,
    required this.fetchedAt,
    this.revalidated = false,
    this.refreshError,
  });

  /// The document.
  final T value;

  /// Whether [value] came from the cache or the network.
  final DataOrigin origin;

  /// When [value] was fetched or last confirmed unchanged.
  final DateTime fetchedAt;

  /// Whether the network confirmed [value] during this stream: a new
  /// document (`origin` is network) or an unchanged one (HTTP 304, `origin`
  /// is cache). False for a cached value that was not checked.
  final bool revalidated;

  /// Why refreshing a cached [value] failed (for example offline), or `null`.
  final Exception? refreshError;

  /// This snapshot, marked with the [error] that stopped its refresh.
  DataSnapshot<T> withRefreshError(Exception error) {
    return DataSnapshot(
      value: value,
      origin: origin,
      fetchedAt: fetchedAt,
      revalidated: revalidated,
      refreshError: error,
    );
  }
}

/// What [LectioRepository.prefetch] did with each date.
class PrefetchReport {
  /// Creates a report.
  const new({
    required this.fetched,
    required this.upToDate,
    required this.unavailable,
    required this.failed,
  });

  /// Dates fetched or revalidated over the network.
  final List<String> fetched;

  /// Dates already fresh in the cache.
  final List<String> upToDate;

  /// Dates the API does not publish (outside `index.json` → `dates`, or 404).
  final List<String> unavailable;

  /// Dates that could not be fetched, for example offline.
  final List<String> failed;
}

typedef _Cached<T> = ({CachedResponse entry, T value});

/// Offline-first access to the API: cached documents first, then the network.
///
/// Every `watch…` stream emits the cached document at once when there is one,
/// then refreshes it with a conditional request: it emits the new document
/// when it changed, or the cached one again with a new `fetchedAt` when the
/// server confirms it is unchanged (both with [DataSnapshot.revalidated]).
/// A cached document younger than [freshFor] is not refreshed
/// unless `refresh` is true. When the refresh fails, the stream emits the
/// cached document again with [DataSnapshot.refreshError] set; with nothing
/// cached, the stream fails with the error ([ApiException] or
/// [FormatException]). Streams are single-subscription and close when done.
class LectioRepository {
  /// Creates a repository reading through `client` and keeping documents in
  /// `cache`. `clock` gives the device time (default: now); [locale] picks
  /// the documents' language (see [forLocale]).
  new({
    required this._client,
    required this._cache,
    DateTime Function()? clock,
    this.freshFor = const Duration(minutes: 15),
    this.locale = defaultApiLocale,
  }) : _clock = clock ?? DateTime.now;

  final ApiClient _client;
  final ApiCache _cache;
  final DateTime Function() _clock;

  /// How long a cached document is used without asking the network.
  final Duration freshFor;

  /// The locale of the documents read: [defaultApiLocale] at the API root,
  /// another one in its mirror (`sw/…`, L-113). `index.json` is shared.
  final String locale;

  LectioRepository? _root;
  final Map<String, LectioRepository> _mirrors = {};

  /// The repository reading [locale]'s documents (see [apiLocaleFor]) with
  /// the same client, cache, clock and freshness, kept in their own cache
  /// entries. Asking twice for a locale gives the same repository, so
  /// screens can compare it with `identical`.
  LectioRepository forLocale(String locale) {
    final root = _root ?? this;
    if (locale == root.locale) return root;
    return root._mirrors[locale] ??= LectioRepository(
      client: _client,
      cache: _cache,
      clock: _clock,
      freshFor: freshFor,
      locale: locale,
    ).._root = root;
  }

  /// `index.json`.
  Stream<DataSnapshot<ApiIndex>> watchIndex({bool refresh = false}) {
    return _watch(indexPath, ApiIndex.fromJson, refresh: refresh);
  }

  /// `days/{date}.json` for the ISO [date].
  Stream<DataSnapshot<ApiDay>> watchDay(String date, {bool refresh = false}) {
    return _watch(dayPath(date), parseApiDay, refresh: refresh);
  }

  /// The day document for the device's date.
  Stream<DataSnapshot<ApiDay>> watchToday({bool refresh = false}) {
    return watchDay(isoDate(_clock()), refresh: refresh);
  }

  /// `passages/{key}.json`.
  Stream<DataSnapshot<ApiPassage>> watchPassage(
    String key, {
    bool refresh = false,
  }) {
    return _watch(passagePath(key), ApiPassage.fromJson, refresh: refresh);
  }

  /// `passages/index.json`.
  Stream<DataSnapshot<PassageIndex>> watchPassageIndex({bool refresh = false}) {
    return _watch(passageIndexPath, PassageIndex.fromJson, refresh: refresh);
  }

  /// `calendar/{year}.json`.
  Stream<DataSnapshot<ApiCalendar>> watchCalendar(
    int year, {
    bool refresh = false,
  }) {
    return _watch(calendarPath(year), ApiCalendar.fromJson, refresh: refresh);
  }

  /// `upcoming.json`.
  Stream<DataSnapshot<ApiUpcoming>> watchUpcoming({bool refresh = false}) {
    return _watch(upcomingPath, ApiUpcoming.fromJson, refresh: refresh);
  }

  /// Caches the day documents of the next [days] days from the device date,
  /// so they open offline.
  ///
  /// Dates outside `index.json` → `dates` are skipped; the range is not
  /// continuous, so a 404 inside it is expected too. Fresh cached days are
  /// not fetched again. One failing date never stops the others.
  Future<PrefetchReport> prefetch({int days = 7}) async {
    final published = await _publishedDates();
    final fetched = <String>[];
    final upToDate = <String>[];
    final unavailable = <String>[];
    final failed = <String>[];
    for (final date in upcomingDates(_clock(), days)) {
      if (!published(date)) {
        unavailable.add(date);
        continue;
      }
      final path = localizedPath(dayPath(date), locale);
      final cached = await _readCached(path, parseApiDay);
      if (cached != null && _isFresh(cached.entry)) {
        upToDate.add(date);
        continue;
      }
      try {
        await _refresh(path, parseApiDay, cached);
        fetched.add(date);
      } on ApiNotFoundException {
        unavailable.add(date);
      } on Exception {
        failed.add(date);
      }
    }
    return PrefetchReport(
      fetched: fetched,
      upToDate: upToDate,
      unavailable: unavailable,
      failed: failed,
    );
  }

  /// Whether a date may have a day document, from the index when it can be
  /// read; without it every date is tried.
  Future<bool Function(String date)> _publishedDates() async {
    try {
      final index = await watchIndex().last;
      final dates = index.value.dates;
      if (dates == null) return (_) => false;
      return dates.contains;
    } on Exception {
      return (_) => true;
    }
  }

  Stream<DataSnapshot<T>> _watch<T>(
    String documentPath,
    T Function(Object? json) parse, {
    required bool refresh,
  }) async* {
    final path = localizedPath(documentPath, locale);
    final cached = await _readCached(path, parse);
    final DataSnapshot<T>? fromCache;
    if (cached == null) {
      fromCache = null;
    } else {
      fromCache = DataSnapshot(
        value: cached.value,
        origin: DataOrigin.cache,
        fetchedAt: cached.entry.fetchedAt,
      );
      yield fromCache;
      if (!refresh && _isFresh(cached.entry)) return;
    }
    try {
      yield await _refresh(path, parse, cached);
    } on Exception catch (error) {
      if (fromCache == null) rethrow;
      yield fromCache.withRefreshError(error);
    }
  }

  bool _isFresh(CachedResponse entry) {
    // A fetch time in the future means the device clock was ahead when it
    // was stored: the age is unknown, so the entry is stale.
    final age = _clock().difference(entry.fetchedAt);
    return !age.isNegative && age < freshFor;
  }

  Future<_Cached<T>?> _readCached<T>(
    String path,
    T Function(Object? json) parse,
  ) async {
    try {
      final entry = await _cache.read(path);
      if (entry == null) return null;
      return (entry: entry, value: parse(jsonDecode(entry.body)));
    } on Exception {
      // An unreadable entry is as good as none: fetch it again.
      return null;
    }
  }

  /// Fetches [path], conditionally when [cached], and returns the confirmed
  /// snapshot: the new document, or the cached one when it is unchanged.
  Future<DataSnapshot<T>> _refresh<T>(
    String path,
    T Function(Object? json) parse,
    _Cached<T>? cached,
  ) async {
    final response = await _client.get(
      path,
      etag: cached?.entry.etag,
      lastModified: cached?.entry.lastModified,
    );
    final now = _clock();
    final body = response.body;
    if (body == null) {
      // 304 only answers a conditional request, so there is a cached entry.
      final unchanged = cached!;
      await _store(
        path,
        unchanged.entry.revalidated(
          at: now,
          etag: response.etag,
          lastModified: response.lastModified,
        ),
      );
      return DataSnapshot(
        value: unchanged.value,
        origin: DataOrigin.cache,
        fetchedAt: now,
        revalidated: true,
      );
    }
    final value = parse(jsonDecode(body));
    await _store(
      path,
      CachedResponse(
        body: body,
        fetchedAt: now,
        etag: response.etag,
        lastModified: response.lastModified,
      ),
    );
    return DataSnapshot(
      value: value,
      origin: DataOrigin.network,
      fetchedAt: now,
      revalidated: true,
    );
  }

  Future<void> _store(String path, CachedResponse entry) async {
    try {
      await _cache.write(path, entry);
    } on Exception {
      // The document is still shown; it is fetched again next time.
    }
  }
}
