import 'dart:async';

import 'package:audio_service/audio_service.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lectio/features/listen/listen_audio_handler.dart';
import 'package:lectio/features/listen/listen_queue.dart';

import 'fake_players.dart';

void main() {
  late FakeAudioFilePlayer player;
  late FakeSpeechEngine speech;
  late ListenQueue queue;
  late ListenAudioHandler handler;
  final at = DateTime.utc(2026, 9, 20, 7);

  final segments = [
    testSegment(0, seconds: 74.5),
    testSegment(1),
    testSegment(2, audio: false),
  ];

  setUp(() {
    player = FakeAudioFilePlayer();
    speech = FakeSpeechEngine();
    queue = ListenQueue(player: player, speech: speech);
    handler = ListenAudioHandler(queue, clock: () => at);
  });

  tearDown(() => handler.detach());

  test('publishes an empty, idle queue at first', () {
    expect(handler.queue.value, isEmpty);
    expect(handler.mediaItem.value, isNull);
    final state = handler.playbackState.value;
    expect(state.processingState, AudioProcessingState.idle);
    expect(state.playing, isFalse);
    expect(state.queueIndex, isNull);
    expect(state.controls, contains(MediaControl.play));
  });

  test('publishes the segments and the current one', () async {
    await queue.load('a', segments);
    final items = handler.queue.value;
    expect(items.map((item) => item.id), segments.map((s) => s.id));
    expect(items.first.title, 'Segment 0');
    expect(items.first.album, 'Mt 20:1-16a');
    expect(items.first.artist, 'Lectio');
    expect(items.first.displaySubtitle, 'Mt 20:1-16a · Context');
    expect(items.first.duration, const Duration(milliseconds: 74500));
    expect(items[1].displaySubtitle, 'Mt 20:1-16a · Translation note');
    expect(items[2].duration, isNull);

    await queue.play();
    expect(handler.mediaItem.value?.id, segments.first.id);
    // The file's own length wins over the API's.
    expect(handler.mediaItem.value?.duration, const Duration(seconds: 60));
    final state = handler.playbackState.value;
    expect(state.processingState, AudioProcessingState.ready);
    expect(state.playing, isTrue);
    expect(state.queueIndex, 0);
    expect(state.updateTime, at);
    expect(state.controls, [
      MediaControl.skipToPrevious,
      MediaControl.pause,
      MediaControl.skipToNext,
      MediaControl.stop,
    ]);
    expect(state.systemActions, contains(MediaAction.seek));
  });

  test('publishes the queue only when its segments change', () async {
    await queue.load('a', segments);
    final first = handler.queue.value;
    await queue.play();
    expect(identical(handler.queue.value, first), isTrue);
    await queue.load('b', [segments[1], segments[0], segments[2]]);
    expect(handler.queue.value.first.id, segments[1].id);
  });

  test('maps each status', () async {
    await queue.load('a', [testSegment(0), testSegment(1, audio: false)]);
    final gate = player.loadGate = Completer<void>();
    final started = queue.play();
    expect(
      handler.playbackState.value.processingState,
      AudioProcessingState.loading,
    );
    gate.complete();
    await started;
    await queue.pause();
    expect(
      handler.playbackState.value.processingState,
      AudioProcessingState.ready,
    );
    await queue.next();
    expect(
      handler.playbackState.value.systemActions,
      isNot(contains(MediaAction.seek)),
    );
    speech.complete();
    await settle();
    expect(
      handler.playbackState.value.processingState,
      AudioProcessingState.completed,
    );
  });

  test('passes system commands to the queue', () async {
    await queue.load('a', segments);
    await handler.play();
    expect(queue.status, ListenStatus.playing);
    await handler.pause();
    expect(queue.status, ListenStatus.paused);
    await handler.skipToNext();
    expect(queue.index, 1);
    await handler.skipToPrevious();
    expect(queue.index, 0);
    await handler.skipToQueueItem(2);
    expect(queue.index, 2);
    await handler.skipToQueueItem(0);
    await handler.seek(const Duration(seconds: 5));
    expect(player.position, const Duration(seconds: 5));
    await handler.setSpeed(1.75);
    expect(queue.speed, 1.75);
    await handler.stop();
    expect(queue.status, ListenStatus.idle);
  });

  test('detach stops following the queue', () async {
    handler.detach();
    await queue.load('a', segments);
    expect(handler.queue.value, isEmpty);
  });

  group('startBackgroundAudio', () {
    test('starts the service with a handler on the queue', () async {
      ListenAudioHandler? started;
      await startBackgroundAudio(
        queue,
        init: (handler) async {
          started = handler;
        },
      );
      expect(started?.listen, queue);
      started?.detach();
    });

    test('detaches the handler when the service fails', () async {
      ListenAudioHandler? started;
      await expectLater(
        startBackgroundAudio(
          queue,
          init: (handler) async {
            started = handler;
            throw Exception('no AudioServiceActivity');
          },
        ),
        throwsException,
      );
      await queue.load('a', segments);
      expect(started?.queue.value, isEmpty);
    });
  });
}
