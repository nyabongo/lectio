import 'dart:async';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:lectio/data/data.dart';
import 'package:lectio/features/listen/flutter_tts_speech_engine.dart';
import 'package:lectio/features/listen/just_audio_file_player.dart';
import 'package:lectio/features/listen/listen_audio_handler.dart';
import 'package:lectio/features/listen/listen_queue.dart';
import 'package:lectio/features/listen/listen_segment.dart';
import 'package:lectio/features/listen/listen_strings.dart';
import 'package:lectio/features/settings/app_settings.dart';
import 'package:lectio/features/settings/settings_controller.dart';
import 'package:lectio/features/today/today_screen.dart';
import 'package:lectio/l10n/in_language.dart';
import 'package:lectio/l10n/lectio_localizations.dart';
import 'package:lectio/src/routing/app_route.dart';
import 'package:lectio/src/theme/lectio_theme.dart';

ListenQueue? _appListenQueue;

/// The queue the Listen tab plays, shared by the whole app so narration goes
/// on while the reader moves between tabs, and on the lock screen
/// ([startBackgroundAudio] runs before it first plays). Built on first use;
/// it creates no platform player until something plays.
ListenQueue get appListenQueue {
  return _appListenQueue ??= ListenQueue(
    player: JustAudioFilePlayer(),
    speech: FlutterTtsSpeechEngine(),
    beforeFirstPlay: startBackgroundAudio,
  );
}

/// Replaces the shared queue, for example with one over fake players in
/// tests; `null` builds a new default one on next use.
@visibleForTesting
set appListenQueue(ListenQueue? queue) {
  _appListenQueue = queue;
}

/// The id of the queue of [mass] on [date] in the UI [language], for example
/// `2026-09-20/day` (English) or `2026-09-20/day/sw`.
String listenQueueId(String date, String mass, [String language = 'en']) {
  return language == defaultApiLocale ? '$date/$mass' : '$date/$mass/$language';
}

/// The Listen tab: the day's notes as a queue of narrated segments, with
/// play, pause, skip and speed, each note from its audio file or read by the
/// device voice when the file is not rendered yet.
///
/// It shows the device's date, or [date] (`/listen?date=…`), and the Mass
/// [mass] (default: the first). The day is read offline-first from
/// [repository]; in Kiswahili, reviewed Kiswahili notes come from the `sw/`
/// mirror and play in Kiswahili (`segmentsForMass`). When the device has no
/// Kiswahili voice, the screen says so and those notes play in English.
/// [queue] plays the notes and keeps playing after the screen closes. The
/// speed starts at the reader's Settings choice, and choosing another here
/// saves it there.
class ListenScreen extends StatefulWidget {
  /// Creates the Listen screen.
  const new({
    required this.repository,
    required this.queue,
    this.date,
    this.mass,
    this.clock,
    super.key,
  });

  /// Where the day documents come from.
  final LectioRepository repository;

  /// The queue that plays.
  final ListenQueue queue;

  /// The ISO date to show instead of the device's date.
  final String? date;

  /// The id of the Mass to show first.
  final String? mass;

  /// The device time (default: now).
  final DateTime Function()? clock;

  @override
  State<ListenScreen> createState() => _ListenScreenState();
}

class _ListenScreenState extends State<ListenScreen> {
  late String _date = _initialDate();
  late String? _massId = widget.mass;
  String? _language;
  final List<StreamSubscription<DataSnapshot<ApiDay>>> _subscriptions = [];
  DataSnapshot<ApiDay>? _snapshot;
  ApiDay? _localized;
  Object? _error;
  double? _appliedSpeed;
  Future<bool>? _voiceCheck;
  late final AppLifecycleListener _lifecycle;

  @override
  void initState() {
    super.initState();
    _lifecycle = AppLifecycleListener(onResume: _recheckVoices);
  }

  /// The reader may have installed a voice while away: ask again.
  void _recheckVoices() {
    widget.queue.forgetVoices();
    setState(() => _voiceCheck = null);
  }

  String _initialDate() {
    return parseIsoDate(widget.date) ??
        isoDate((widget.clock ?? DateTime.now)());
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final speed = SettingsScope.of(context).settings.playbackSpeed;
    if (speed != _appliedSpeed) {
      _appliedSpeed = speed;
      unawaited(widget.queue.setSpeed(speed));
    }
    final language = LectioLocalizations.of(context).languageCode;
    if (language != _language) {
      _language = language;
      _voiceCheck = null;
      _reset();
      _listen();
    }
  }

  @override
  void didUpdateWidget(ListenScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.date != oldWidget.date || widget.mass != oldWidget.mass) {
      _date = _initialDate();
      _massId = widget.mass;
      _reset();
      _listen();
    }
  }

  @override
  void dispose() {
    _lifecycle.dispose();
    _cancel();
    super.dispose();
  }

  void _reset() {
    _snapshot = null;
    _localized = null;
    _error = null;
  }

  void _cancel() {
    for (final subscription in _subscriptions) {
      unawaited(subscription.cancel());
    }
    _subscriptions.clear();
  }

  /// Watches the English day, and the UI language's mirror of it when there
  /// is one.
  void _listen() {
    _cancel();
    final english = widget.repository.forLocale(defaultApiLocale);
    _subscriptions.add(
      english.watchDay(_date).listen((snapshot) {
        setState(() {
          _snapshot = snapshot;
          _error = null;
        });
        _refreshQueue();
      }, onError: (Object error) => setState(() => _error = error)),
    );
    final locale = apiLocaleFor(_language);
    if (locale == defaultApiLocale) return;
    _subscriptions.add(
      widget.repository
          .forLocale(locale)
          .watchDay(_date)
          .listen(
            (snapshot) {
              setState(() => _localized = snapshot.value);
              _refreshQueue();
            },
            onError: (Object error) {
              // Without the mirror the notes play in English.
              debugPrint('Listen: no $locale day ($error)');
            },
          ),
    );
  }

  void _retry() {
    setState(() => _error = null);
    _listen();
  }

  /// The queue of [mass], in the UI language.
  List<ListenSegment> _segments(Mass<DayReading> mass) {
    Mass<DayReading>? localized;
    for (final candidate in _localized?.masses ?? <Mass<DayReading>>[]) {
      if (candidate.id == mass.id) localized = candidate;
    }
    return segmentsForMass(
      mass,
      localized: localized,
      language: _language ?? defaultApiLocale,
    );
  }

  String _queueId(Mass<DayReading> mass) {
    return listenQueueId(
      _snapshot!.value.date,
      mass.id,
      _language ?? defaultApiLocale,
    );
  }

  /// Gives the queue newly rendered audio or translations when it already
  /// plays this day.
  void _refreshQueue() {
    final snapshot = _snapshot;
    if (snapshot == null) return;
    for (final mass in snapshot.value.masses) {
      final id = _queueId(mass);
      final segments = _segments(mass);
      if (widget.queue.holds(id, segments)) {
        unawaited(widget.queue.load(id, segments));
      }
    }
  }

  /// Plays [segments] from [index], or toggles play and pause with `null`,
  /// loading them into the queue first when it holds something else.
  Future<void> _playFrom(
    String id,
    List<ListenSegment> segments,
    int? index,
  ) async {
    final queue = widget.queue;
    if (!queue.holds(id, segments)) await queue.load(id, segments);
    if (index == null) {
      await queue.toggle();
    } else {
      await queue.skipTo(index);
    }
  }

  void _chooseSpeed(double speed) {
    final settings = SettingsScope.of(context);
    unawaited(
      settings.update(settings.settings.copyWith(playbackSpeed: speed)),
    );
  }

  /// Whether to say the device has no voice for [segments]' language: only
  /// when a translated note has no recording, and asked once.
  Future<bool>? _missingVoice(List<ListenSegment> segments) {
    for (final segment in segments) {
      if (segment.usesSpeech && segment.fallback != null) {
        return _voiceCheck ??= widget.queue
            .canSpeak(segment.locale)
            .then((able) => !able);
      }
    }
    return null;
  }

  @override
  Widget build(BuildContext context) {
    final strings = ListenStrings.of(context);
    final snapshot = _snapshot;
    final error = _error;
    if (snapshot == null) {
      if (error == null) {
        return const Center(child: CircularProgressIndicator());
      }
      return _Message(
        text: error is ApiNotFoundException
            ? strings.emptyDay
            : strings.loadFailed,
        onRetry: error is ApiNotFoundException ? null : _retry,
      );
    }
    final day = snapshot.value;
    final masses = [
      for (final mass in day.masses)
        if (_segments(mass).isNotEmpty) mass,
    ];
    final Widget content;
    if (masses.isEmpty) {
      content = _Message(text: strings.nothingToPlay);
    } else {
      final mass = masses.firstWhere(
        (mass) => mass.id == _massId,
        orElse: () => masses.first,
      );
      final id = _queueId(mass);
      final segments = _segments(mass);
      content = ListenableBuilder(
        listenable: widget.queue,
        builder: (context, _) => _QueueView(
          day: day,
          masses: masses,
          mass: mass,
          segments: segments,
          queue: widget.queue,
          loaded: widget.queue.holds(id, segments),
          offline: snapshot.refreshError != null,
          missingVoice: _missingVoice(segments),
          onMass: (id) => setState(() => _massId = id),
          onPlay: (index) => unawaited(_playFrom(id, segments, index)),
          onSpeed: _chooseSpeed,
        ),
      );
    }
    return Theme(
      data: buildLectioTheme(
        day.liturgicalColour,
        Theme.of(context).brightness,
      ),
      child: content,
    );
  }
}

class _Message extends StatelessWidget {
  const new({required this.text, this.onRetry});

  final String text;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    final retry = onRetry;
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Text(text),
        if (retry != null) ...[
          const SizedBox(height: 8),
          Align(
            alignment: AlignmentDirectional.centerStart,
            child: FilledButton.tonal(
              onPressed: retry,
              child: Text(ListenStrings.of(context).retry),
            ),
          ),
        ],
      ],
    );
  }
}

/// Says the device has no voice for the notes' language once [missing]
/// completes with `true`.
class _MissingVoice extends StatelessWidget {
  const new({required this.missing});

  final Future<bool> missing;

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<bool>(
      future: missing,
      builder: (context, snapshot) {
        if (snapshot.data != true) return const SizedBox.shrink();
        return Padding(
          padding: const EdgeInsets.only(top: 8),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Icon(Icons.info_outline, size: 18),
              const SizedBox(width: 6),
              Expanded(child: Text(ListenStrings.of(context).noVoice)),
            ],
          ),
        );
      },
    );
  }
}

/// The player and the queue of one Mass. [loaded] says whether [queue]
/// holds [segments]; otherwise it shows them ready to play, while [queue]
/// may go on playing another day.
class _QueueView extends StatelessWidget {
  const new({
    required this.day,
    required this.masses,
    required this.mass,
    required this.segments,
    required this.queue,
    required this.loaded,
    required this.offline,
    required this.missingVoice,
    required this.onMass,
    required this.onPlay,
    required this.onSpeed,
  });

  final ApiDay day;
  final List<Mass<DayReading>> masses;
  final Mass<DayReading> mass;
  final List<ListenSegment> segments;
  final ListenQueue queue;
  final bool loaded;
  final bool offline;
  final Future<bool>? missingVoice;
  final ValueChanged<String> onMass;

  /// Plays from a segment, or toggles play and pause with `null`.
  final ValueChanged<int?> onPlay;
  final ValueChanged<double> onSpeed;

  @override
  Widget build(BuildContext context) {
    final strings = ListenStrings.of(context);
    final theme = Theme.of(context);
    final index = loaded ? queue.index : 0;
    final current = segments[index];
    final status = loaded ? queue.status : ListenStatus.idle;
    final active = loaded && queue.active;
    final speaking = loaded ? queue.speaking : current.usesSpeech;
    final fallingBack = loaded && queue.fallingBack;
    final celebration = day.celebrations.isEmpty
        ? null
        : day.celebrations.first.nameIn(strings.languageCode);
    final missing = missingVoice;
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        if (celebration != null)
          InLanguage(
            language: celebration.language,
            child: Text(celebration.text, style: theme.textTheme.titleLarge),
          ),
        if (masses.length > 1) ...[
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final item in masses)
                ChoiceChip(
                  label: Text(item.label),
                  selected: item.id == mass.id,
                  onSelected: (_) => onMass(item.id),
                ),
            ],
          ),
        ] else
          Text(mass.label, style: theme.textTheme.bodyMedium),
        if (offline) ...[const SizedBox(height: 8), Text(strings.offline)],
        if (missing != null) _MissingVoice(missing: missing),
        const SizedBox(height: 16),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '${strings.position(index, segments.length)} · '
                  '${current.ref} · ${strings.kindLabel(current.kind)}',
                  style: theme.textTheme.labelLarge,
                ),
                const SizedBox(height: 4),
                InLanguage(
                  language: current.locale,
                  child: Text(
                    current.title,
                    style: theme.textTheme.titleMedium,
                  ),
                ),
                if (fallingBack) ...[
                  const SizedBox(height: 4),
                  _Marker(icon: Icons.translate, text: strings.inEnglish),
                ],
                if (speaking) ...[
                  const SizedBox(height: 4),
                  _Marker(
                    icon: Icons.record_voice_over_outlined,
                    text: strings.deviceVoice,
                  ),
                ],
                if (status == ListenStatus.completed) ...[
                  const SizedBox(height: 4),
                  Text(strings.finished),
                ],
                if (loaded &&
                    !speaking &&
                    status != ListenStatus.idle &&
                    status != ListenStatus.completed)
                  _Progress(queue: queue),
                const SizedBox(height: 8),
                _Controls(
                  strings: strings,
                  active: active,
                  canGoBack: loaded,
                  canGoOn: loaded && index + 1 < segments.length,
                  speed: queue.speed,
                  onToggle: () => onPlay(null),
                  onPrevious: () => unawaited(queue.previous()),
                  onNext: () => unawaited(queue.next()),
                  onSpeed: onSpeed,
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 16),
        Text(strings.queue, style: theme.textTheme.titleMedium),
        for (final (i, segment) in segments.indexed)
          ListTile(
            contentPadding: EdgeInsets.zero,
            selected: loaded && i == index,
            leading: Icon(
              loaded && i == index && active
                  ? Icons.graphic_eq
                  : Icons.play_circle_outline,
            ),
            title: InLanguage(
              language: segment.locale,
              child: Text(segment.title),
            ),
            subtitle: Text(_subtitle(strings, segment)),
            onTap: () => onPlay(i),
          ),
      ],
    );
  }

  String _subtitle(ListenStrings strings, ListenSegment segment) {
    final length = segment.audio?.duration;
    return [
      segment.ref,
      strings.kindLabel(segment.kind),
      if (segment.usesSpeech) strings.deviceVoice,
      if (length != null) clockLabel(length),
    ].join(' · ');
  }
}

/// A small icon and label under the current segment's title.
class _Marker extends StatelessWidget {
  const new({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Icon(icon, size: 18),
        const SizedBox(width: 6),
        Flexible(child: Text(text)),
      ],
    );
  }
}

class _Progress extends StatelessWidget {
  const new({required this.queue});

  final ListenQueue queue;

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<Duration>(
      stream: queue.positions,
      initialData: queue.position,
      builder: (context, snapshot) {
        final position = snapshot.data ?? Duration.zero;
        final length = queue.duration;
        final fraction = length == null || length == Duration.zero
            ? null
            : (position.inMilliseconds / length.inMilliseconds).clamp(0.0, 1.0);
        return Padding(
          padding: const EdgeInsets.only(top: 8),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (fraction != null) ...[
                LinearProgressIndicator(value: fraction),
                const SizedBox(height: 4),
              ],
              Text(
                length == null
                    ? clockLabel(position)
                    : '${clockLabel(position)} / ${clockLabel(length)}',
              ),
            ],
          ),
        );
      },
    );
  }
}

class _Controls extends StatelessWidget {
  const new({
    required this.strings,
    required this.active,
    required this.canGoBack,
    required this.canGoOn,
    required this.speed,
    required this.onToggle,
    required this.onPrevious,
    required this.onNext,
    required this.onSpeed,
  });

  final ListenStrings strings;
  final bool active;
  final bool canGoBack;
  final bool canGoOn;
  final double speed;
  final VoidCallback onToggle;
  final VoidCallback onPrevious;
  final VoidCallback onNext;
  final ValueChanged<double> onSpeed;

  @override
  Widget build(BuildContext context) {
    return Wrap(
      crossAxisAlignment: WrapCrossAlignment.center,
      spacing: 8,
      children: [
        IconButton(
          tooltip: strings.previous,
          icon: const Icon(Icons.skip_previous),
          onPressed: canGoBack ? onPrevious : null,
        ),
        IconButton.filled(
          tooltip: active ? strings.pause : strings.play,
          iconSize: 36,
          icon: Icon(active ? Icons.pause : Icons.play_arrow),
          onPressed: onToggle,
        ),
        IconButton(
          tooltip: strings.next,
          icon: const Icon(Icons.skip_next),
          onPressed: canGoOn ? onNext : null,
        ),
        PopupMenuButton<double>(
          tooltip: strings.speed,
          initialValue: speed,
          onSelected: onSpeed,
          itemBuilder: (context) => [
            for (final option in playbackSpeeds)
              PopupMenuItem(value: option, child: Text(speedLabel(option))),
          ],
          child: Container(
            constraints: const BoxConstraints(minWidth: 48, minHeight: 48),
            alignment: Alignment.center,
            padding: const EdgeInsets.symmetric(horizontal: 12),
            child: Text(speedLabel(speed)),
          ),
        ),
      ],
    );
  }
}

/// The Listen route inside the tab shell. `/listen?date=yyyy-mm-dd&mass=id`
/// opens another day or Mass.
///
/// [repository] defaults to the shared [appRepository] and [queue] to
/// [appListenQueue]; [clock] is for tests.
GoRoute listenRoute({
  LectioRepository? repository,
  ListenQueue? queue,
  DateTime Function()? clock,
}) {
  return GoRoute(
    path: AppRoute.listen.path,
    name: AppRoute.listen.name,
    builder: (context, state) => ListenScreen(
      repository: repository ?? appRepository,
      queue: queue ?? appListenQueue,
      date: state.uri.queryParameters['date'],
      mass: state.uri.queryParameters['mass'],
      clock: clock,
    ),
  );
}
