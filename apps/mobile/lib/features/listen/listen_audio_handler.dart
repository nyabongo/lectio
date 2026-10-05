import 'dart:async';

import 'package:audio_service/audio_service.dart';
import 'package:lectio/features/listen/listen_queue.dart';
import 'package:lectio/features/listen/listen_segment.dart';

/// The Android notification channel of the Listen controls.
const String listenNotificationChannelId = 'io.github.nyabongo.lectio.listen';

/// The Listen queue on the lock screen, in the notification shade, on
/// headphones and in the car: audio_service's handler, mirroring a
/// [ListenQueue].
///
/// It publishes the queue's segments, the current one and the play state,
/// and passes the system's play, pause, skip, seek and speed commands back
/// to it.
class ListenAudioHandler extends BaseAudioHandler {
  /// Creates a handler for [listen], which it follows until [detach].
  new(this.listen, {DateTime Function()? clock})
    : _clock = clock ?? DateTime.now {
    listen.addListener(_publish);
    _publish();
  }

  /// The Listen queue the system controls.
  final ListenQueue listen;

  final DateTime Function() _clock;

  List<String> _publishedIds = const [];

  /// Stops following [listen].
  void detach() => listen.removeListener(_publish);

  void _publish() {
    final segments = listen.segments;
    final ids = [for (final segment in segments) segment.id];
    if (!_sameIds(ids)) {
      _publishedIds = ids;
      queue.add([for (final segment in segments) mediaItemFor(segment)]);
    }
    final current = listen.current;
    mediaItem.add(
      current == null ? null : mediaItemFor(current, duration: listen.duration),
    );
    playbackState.add(stateOf(listen, at: _clock()));
  }

  bool _sameIds(List<String> ids) {
    if (ids.length != _publishedIds.length) return false;
    for (var i = 0; i < ids.length; i++) {
      if (ids[i] != _publishedIds[i]) return false;
    }
    return true;
  }

  @override
  Future<void> play() => listen.play();

  @override
  Future<void> pause() => listen.pause();

  @override
  Future<void> stop() async {
    await listen.stop();
    await super.stop();
  }

  @override
  Future<void> skipToNext() => listen.next();

  @override
  Future<void> skipToPrevious() => listen.previous();

  @override
  Future<void> skipToQueueItem(int index) => listen.skipTo(index);

  @override
  Future<void> seek(Duration position) => listen.seek(position);

  @override
  Future<void> setSpeed(double speed) => listen.setSpeed(speed);
}

/// [segment] as a media item: its title, the passage and the kind of note.
MediaItem mediaItemFor(ListenSegment segment, {Duration? duration}) {
  return MediaItem(
    id: segment.id,
    title: segment.title,
    album: segment.ref,
    artist: 'Lectio',
    displaySubtitle: segment.kind == SegmentKind.context
        ? '${segment.ref} · Context'
        : '${segment.ref} · Translation note',
    duration: duration ?? segment.audio?.duration,
  );
}

/// What the system shows for [queue] at the time [at].
PlaybackState stateOf(ListenQueue queue, {required DateTime at}) {
  final status = queue.status;
  return PlaybackState(
    controls: [
      MediaControl.skipToPrevious,
      if (queue.active) MediaControl.pause else MediaControl.play,
      MediaControl.skipToNext,
      MediaControl.stop,
    ],
    androidCompactActionIndices: const [0, 1, 2],
    systemActions: {
      MediaAction.skipToQueueItem,
      MediaAction.setSpeed,
      if (!queue.speaking) MediaAction.seek,
    },
    processingState: switch (status) {
      ListenStatus.idle => AudioProcessingState.idle,
      ListenStatus.loading => AudioProcessingState.loading,
      ListenStatus.playing || ListenStatus.paused => AudioProcessingState.ready,
      ListenStatus.completed => AudioProcessingState.completed,
    },
    playing: queue.active,
    updatePosition: queue.position,
    updateTime: at,
    speed: queue.speed,
    queueIndex: queue.segments.isEmpty ? null : queue.index,
  );
}

/// Starts audio_service with [handler]; the default for
/// [startBackgroundAudio].
Future<void> initAudioService(ListenAudioHandler handler) async {
  await AudioService.init(
    builder: () => handler,
    config: const AudioServiceConfig(
      androidNotificationChannelId: listenNotificationChannelId,
      androidNotificationChannelName: 'Listen',
      androidNotificationOngoing: true,
    ),
  );
}

/// Puts [queue] on the lock screen and keeps it playing in the background,
/// through [init] (default: [initAudioService]). The queue calls it before
/// it first plays.
Future<void> startBackgroundAudio(
  ListenQueue queue, {
  Future<void> Function(ListenAudioHandler handler) init = initAudioService,
}) async {
  final handler = ListenAudioHandler(queue);
  try {
    await init(handler);
  } on Object {
    handler.detach();
    rethrow;
  }
}
