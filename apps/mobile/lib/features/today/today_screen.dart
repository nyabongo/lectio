import 'dart:async';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:lectio/data/data.dart';
import 'package:lectio/features/today/day_view.dart';
import 'package:lectio/features/today/today_labels.dart';
import 'package:lectio/src/routing/app_route.dart';
import 'package:lectio/src/theme/lectio_theme.dart';
import 'package:url_launcher/url_launcher.dart';

/// Opens [url] outside the app; `false` when nothing could open it.
typedef UrlOpener = Future<bool> Function(Uri url);

/// Launches a URL in [mode], as `url_launcher`'s `launchUrl` does.
typedef UrlLauncher = Future<bool> Function(Uri url, {LaunchMode mode});

/// Whether [url] may be opened as a link-out: `https` only, so a bad or
/// tampered document can never launch `intent:`, `tel:`, `file:` or plain
/// `http:` links (decision 001).
bool isSafeLinkout(Uri url) => url.scheme == 'https';

/// Opens [url] in the browser or the app that handles it, through [launch]
/// (default: `launchUrl`); `false` without launching when it is not
/// [isSafeLinkout].
Future<bool> openExternally(Uri url, {UrlLauncher launch = launchUrl}) {
  if (!isSafeLinkout(url)) return Future.value(false);
  return launch(url, mode: LaunchMode.externalApplication);
}

final RegExp _isoDate = RegExp(r'^(\d{4})-(\d{2})-(\d{2})$');

/// [date] as a normalised ISO date, or `null` when it is not `yyyy-mm-dd`.
///
/// Out-of-range parts roll over, so `2026-02-30` reads as `2026-03-02`.
String? parseIsoDate(String? date) {
  final match = _isoDate.firstMatch(date ?? '');
  if (match == null) return null;
  return isoDate(
    DateTime(
      int.parse(match.group(1)!),
      int.parse(match.group(2)!),
      int.parse(match.group(3)!),
    ),
  );
}

/// The location of the Today tab for [date]: plain `/today` for [today].
String todayLocation(String date, {required String today}) {
  if (date == today) return AppRoute.today.path;
  return Uri(
    path: AppRoute.today.path,
    queryParameters: {'date': date},
  ).toString();
}

/// The location of the Reading tab for the reading in [slot] of the Mass
/// [mass] (its `masses[].id`, as `day` or `vigil`) on [date]. The Mass
/// tells apart a slot that two Masses of one day share.
String readingLocation(String date, String mass, String slot) {
  return Uri(
    path: AppRoute.reading.path,
    queryParameters: {'date': date, 'mass': mass, 'slot': slot},
  ).toString();
}

/// The location of the Listen tab for [date].
String listenLocation(String date) {
  return Uri(
    path: AppRoute.listen.path,
    queryParameters: {'date': date},
  ).toString();
}

/// The Today tab: the day's date, celebration and colour, and its readings
/// with their notes and link-outs, as on the site's Today page.
///
/// It shows the device's date, or [date] when given (`/today?date=…`). The
/// date button opens a date picker; the picked day goes into the location,
/// so it can be restored and shared. The day is read
/// offline-first from [repository] and tints the screen with its liturgical
/// colour; pulling down refreshes it.
class TodayScreen extends StatefulWidget {
  /// Creates the Today screen.
  const new({
    required this.repository,
    this.date,
    this.clock,
    this.openUrl,
    super.key,
  });

  /// Where the day documents come from.
  final LectioRepository repository;

  /// The ISO date to show instead of the device's date.
  final String? date;

  /// The device time (default: now).
  final DateTime Function()? clock;

  /// Opens a link-out (default: [openExternally]).
  final UrlOpener? openUrl;

  @override
  State<TodayScreen> createState() => _TodayScreenState();
}

class _TodayScreenState extends State<TodayScreen> {
  late String _date = _initialDate();
  StreamSubscription<DataSnapshot<ApiDay>>? _subscription;
  DataSnapshot<ApiDay>? _snapshot;
  Object? _error;

  DateTime _now() => (widget.clock ?? DateTime.now)();

  String get _today => isoDate(_now());

  String _initialDate() => parseIsoDate(widget.date) ?? _today;

  @override
  void initState() {
    super.initState();
    unawaited(_listen());
  }

  @override
  void didUpdateWidget(TodayScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.date != oldWidget.date) {
      _reset(_initialDate());
      unawaited(_listen());
    }
  }

  @override
  void dispose() {
    unawaited(_subscription?.cancel());
    super.dispose();
  }

  void _reset(String date) {
    _date = date;
    _snapshot = null;
    _error = null;
  }

  void _show(String date) {
    setState(() => _reset(date));
    unawaited(_listen());
  }

  /// Watches the day; completes when the repository has nothing more to say.
  Future<void> _listen({bool refresh = false}) {
    final done = Completer<void>();
    unawaited(_subscription?.cancel());
    _subscription = widget.repository
        .watchDay(_date, refresh: refresh)
        .listen(
          (snapshot) => setState(() {
            _snapshot = snapshot;
            _error = null;
          }),
          onError: (Object error) => setState(() => _error = error),
          onDone: done.complete,
        );
    return done.future;
  }

  Future<void> _pickDate() async {
    final current = DateTime.parse(_date);
    final now = _now();
    final earliest = current.isBefore(now) ? current : now;
    final latest = current.isAfter(now) ? current : now;
    final picked = await showDatePicker(
      context: context,
      initialDate: current,
      firstDate: DateTime(earliest.year - 1),
      lastDate: DateTime(latest.year + 1, 12, 31),
      helpText: TodayStrings.chooseDate,
    );
    if (picked == null || !mounted) return;
    context.go(todayLocation(isoDate(picked), today: _today));
  }

  Future<bool> _tryOpen(Uri url) async {
    if (!isSafeLinkout(url)) return false;
    try {
      return await (widget.openUrl ?? openExternally)(url);
    } on Exception {
      return false;
    }
  }

  Future<void> _openText(DayReading reading) async {
    final messenger = ScaffoldMessenger.of(context);
    if (!await _tryOpen(reading.linkout)) {
      messenger.showSnackBar(
        const SnackBar(content: Text(TodayStrings.linkFailed)),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final snapshot = _snapshot;
    final error = _error;
    if (snapshot == null && error == null) {
      return const Center(child: CircularProgressIndicator());
    }
    final today = _today;
    final header = DayHeader(
      date: _date,
      day: snapshot?.value,
      onPickDate: () => unawaited(_pickDate()),
      onToday: _date == today
          ? null
          : () => context.go(todayLocation(today, today: today)),
    );
    final Widget body;
    if (snapshot != null) {
      body = DayDetails(
        snapshot: snapshot,
        onListen: () => context.go(listenLocation(_date)),
        onNotes: (mass, reading) =>
            context.go(readingLocation(_date, mass.id, reading.slot)),
        onText: (reading) => unawaited(_openText(reading)),
      );
    } else if (error is ApiNotFoundException) {
      body = const Text(TodayStrings.emptyDay);
    } else {
      body = Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(TodayStrings.loadFailed),
          const SizedBox(height: 8),
          FilledButton.tonal(
            onPressed: () => _show(_date),
            child: const Text(TodayStrings.retry),
          ),
        ],
      );
    }
    final content = RefreshIndicator(
      onRefresh: () => _listen(refresh: true),
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(16),
        children: [header, const SizedBox(height: 16), body],
      ),
    );
    if (snapshot == null) return content;
    return Theme(
      data: buildLectioTheme(
        snapshot.value.liturgicalColour,
        Theme.of(context).brightness,
      ),
      child: content,
    );
  }
}

/// The Today route inside the tab shell. `/today?date=yyyy-mm-dd` opens
/// another day.
///
/// [repository] defaults to the shared [appRepository]; [clock] and
/// [openUrl] are for tests.
GoRoute todayRoute({
  LectioRepository? repository,
  DateTime Function()? clock,
  UrlOpener? openUrl,
}) {
  return GoRoute(
    path: AppRoute.today.path,
    name: AppRoute.today.name,
    builder: (context, state) => TodayScreen(
      repository: repository ?? appRepository,
      date: state.uri.queryParameters['date'],
      clock: clock,
      openUrl: openUrl,
    ),
  );
}
