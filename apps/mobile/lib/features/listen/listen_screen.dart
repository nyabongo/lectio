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

/// The id of the queue of [mass] on [date], for example `2026-09-20/day`.
String listenQueueId(String date, String mass) => '$date/$mass';

/// The Listen tab: the day's notes as a queue of narrated segments, with
/// play, pause, skip and speed, each note from its audio file or read by the
/// device voice when the file is not rendered yet.
///
/// It shows the device's date, or [date] (`/listen?date=…`), and the Mass
/// [mass] (default: the first). The day is read offline-first from
/// [repository]; [queue] plays it and keeps playing after the screen
/// closes. The speed starts at the reader's Settings choice, and choosing
/// another here saves it there.
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
  StreamSubscription<DataSnapshot<ApiDay>>? _subscription;
  DataSnapshot<ApiDay>? _snapshot;
  Object? _error;
  double? _appliedSpeed;

  String _initialDate() {
    return parseIsoDate(widget.date) ??
        isoDate((widget.clock ?? DateTime.now)());
  }

  @override
  void initState() {
    super.initState();
    _listen();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final speed = SettingsScope.of(context).settings.playbackSpeed;
    if (speed != _appliedSpeed) {
      _appliedSpeed = speed;
      unawaited(widget.queue.setSpeed(speed));
    }
  }

  @override
  void didUpdateWidget(ListenScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.date != oldWidget.date || widget.mass != oldWidget.mass) {
      _date = _initialDate();
      _massId = widget.mass;
      _snapshot = null;
      _error = null;
      _listen();
    }
  }

  @override
  void dispose() {
    unawaited(_subscription?.cancel());
    super.dispose();
  }

  void _listen() {
    unawaited(_subscription?.cancel());
    _subscription = widget.repository.watchDay(_date).listen((snapshot) {
      setState(() {
        _snapshot = snapshot;
        _error = null;
      });
      _refreshQueue(snapshot.value);
    }, onError: (Object error) => setState(() => _error = error));
  }

  void _retry() {
    setState(() => _error = null);
    _listen();
  }

  /// Gives the queue newly rendered audio when it already plays this day.
  void _refreshQueue(ApiDay day) {
    for (final mass in day.masses) {
      final id = listenQueueId(day.date, mass.id);
      final segments = segmentsForMass(mass);
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

  @override
  Widget build(BuildContext context) {
    final snapshot = _snapshot;
    final error = _error;
    if (snapshot == null) {
      if (error == null) {
        return const Center(child: CircularProgressIndicator());
      }
      return _Message(
        text: error is ApiNotFoundException
            ? ListenStrings.emptyDay
            : ListenStrings.loadFailed,
        onRetry: error is ApiNotFoundException ? null : _retry,
      );
    }
    final day = snapshot.value;
    final masses = [
      for (final mass in day.masses)
        if (segmentsForMass(mass).isNotEmpty) mass,
    ];
    final Widget content;
    if (masses.isEmpty) {
      content = const _Message(text: ListenStrings.nothingToPlay);
    } else {
      final mass = masses.firstWhere(
        (mass) => mass.id == _massId,
        orElse: () => masses.first,
      );
      final id = listenQueueId(day.date, mass.id);
      final segments = segmentsForMass(mass);
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
              child: const Text(ListenStrings.retry),
            ),
          ),
        ],
      ],
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
  final ValueChanged<String> onMass;

  /// Plays from a segment, or toggles play and pause with `null`.
  final ValueChanged<int?> onPlay;
  final ValueChanged<double> onSpeed;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final index = loaded ? queue.index : 0;
    final current = segments[index];
    final status = loaded ? queue.status : ListenStatus.idle;
    final active = loaded && queue.active;
    final speaking = loaded ? queue.speaking : current.usesSpeech;
    final celebration = day.celebrations.isEmpty
        ? null
        : day.celebrations.first.name;
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        if (celebration != null)
          Text(celebration, style: theme.textTheme.titleLarge),
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
        if (offline) ...[
          const SizedBox(height: 8),
          const Text(ListenStrings.offline),
        ],
        const SizedBox(height: 16),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '${ListenStrings.position(index, segments.length)} · '
                  '${current.ref} · ${ListenStrings.kindLabel(current.kind)}',
                  style: theme.textTheme.labelLarge,
                ),
                const SizedBox(height: 4),
                Text(current.title, style: theme.textTheme.titleMedium),
                if (speaking) ...[
                  const SizedBox(height: 4),
                  const _DeviceVoice(),
                ],
                if (status == ListenStatus.completed) ...[
                  const SizedBox(height: 4),
                  const Text(ListenStrings.finished),
                ],
                if (loaded &&
                    !speaking &&
                    status != ListenStatus.idle &&
                    status != ListenStatus.completed)
                  _Progress(queue: queue),
                const SizedBox(height: 8),
                _Controls(
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
        Text(ListenStrings.queue, style: theme.textTheme.titleMedium),
        for (final (i, segment) in segments.indexed)
          ListTile(
            contentPadding: EdgeInsets.zero,
            selected: loaded && i == index,
            leading: Icon(
              loaded && i == index && active
                  ? Icons.graphic_eq
                  : Icons.play_circle_outline,
            ),
            title: Text(segment.title),
            subtitle: Text(_subtitle(segment)),
            onTap: () => onPlay(i),
          ),
      ],
    );
  }

  String _subtitle(ListenSegment segment) {
    final length = segment.audio?.duration;
    return [
      segment.ref,
      ListenStrings.kindLabel(segment.kind),
      if (segment.usesSpeech) ListenStrings.deviceVoice,
      if (length != null) clockLabel(length),
    ].join(' · ');
  }
}

class _DeviceVoice extends StatelessWidget {
  const new();

  @override
  Widget build(BuildContext context) {
    return const Row(
      children: [
        Icon(Icons.record_voice_over_outlined, size: 18),
        SizedBox(width: 6),
        Flexible(child: Text(ListenStrings.deviceVoice)),
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
    required this.active,
    required this.canGoBack,
    required this.canGoOn,
    required this.speed,
    required this.onToggle,
    required this.onPrevious,
    required this.onNext,
    required this.onSpeed,
  });

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
          tooltip: ListenStrings.previous,
          icon: const Icon(Icons.skip_previous),
          onPressed: canGoBack ? onPrevious : null,
        ),
        IconButton.filled(
          tooltip: active ? ListenStrings.pause : ListenStrings.play,
          iconSize: 36,
          icon: Icon(active ? Icons.pause : Icons.play_arrow),
          onPressed: onToggle,
        ),
        IconButton(
          tooltip: ListenStrings.next,
          icon: const Icon(Icons.skip_next),
          onPressed: canGoOn ? onNext : null,
        ),
        PopupMenuButton<double>(
          tooltip: ListenStrings.speed,
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
