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
    this.refreshError,
  });

  /// The document.
  final T value;

  /// Whether [value] came from the cache or the network.
  final DataOrigin origin;

  /// When [value] was fetched or last confirmed unchanged.
  final DateTime fetchedAt;

  /// Why refreshing a cached [value] failed (for example offline), or `null`.
  final Exception? refreshError;

  /// This snapshot, marked with the [error] that stopped its refresh.
  DataSnapshot<T> withRefreshError(Exception error) {
    return DataSnapshot(
      value: value,
      origin: origin,
      fetchedAt: fetchedAt,
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
/// then refreshes it with a conditional request and emits the new document
/// if it changed. A cached document younger than [freshFor] is not refreshed
/// unless `refresh` is true. When the refresh fails, the stream emits the
/// cached document again with [DataSnapshot.refreshError] set; with nothing
/// cached, the stream fails with the error ([ApiException] or
/// [FormatException]). Streams are single-subscription and close when done.
class LectioRepository {
  /// Creates a repository reading through `client` and keeping documents in
  /// `cache`. `clock` gives the device time (default: now).
  new({
    required this._client,
    required this._cache,
    DateTime Function()? clock,
    this.freshFor = const Duration(minutes: 15),
  }) : _clock = clock ?? DateTime.now;

  final ApiClient _client;
  final ApiCache _cache;
  final DateTime Function() _clock;

  /// How long a cached document is used without asking the network.
  final Duration freshFor;

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
      final path = dayPath(date);
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
    String path,
    T Function(Object? json) parse, {
    required bool refresh,
  }) async* {
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
      final fresh = await _refresh(path, parse, cached);
      if (fresh != null) yield fresh;
    } on Exception catch (error) {
      if (fromCache == null) rethrow;
      yield fromCache.withRefreshError(error);
    }
  }

  bool _isFresh(CachedResponse entry) {
    return _clock().difference(entry.fetchedAt) < freshFor;
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

  /// Fetches [path], conditionally when [cached]. Returns the new snapshot,
  /// or `null` when the cached document is unchanged.
  Future<DataSnapshot<T>?> _refresh<T>(
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
      await _store(
        path,
        cached!.entry.revalidated(
          at: now,
          etag: response.etag,
          lastModified: response.lastModified,
        ),
      );
      return null;
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
