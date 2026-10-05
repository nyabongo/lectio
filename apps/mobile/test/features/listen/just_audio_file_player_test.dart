import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:just_audio/just_audio.dart';
import 'package:lectio/features/listen/just_audio_file_player.dart';

class _FakeAudioPlayer extends Fake implements AudioPlayer {
  final List<String> calls = [];
  final StreamController<ProcessingState> states = StreamController();
  final StreamController<PlayerException> errors = StreamController();
  final StreamController<Duration> positions = StreamController();
  final Completer<void> playEnded = Completer();

  @override
  Stream<ProcessingState> get processingStateStream => states.stream;

  @override
  Stream<PlayerException> get errorStream => errors.stream;

  @override
  Stream<Duration> get positionStream => positions.stream;

  @override
  Duration get position => const Duration(seconds: 7);

  @override
  Future<Duration?> setAudioSource(
    AudioSource source, {
    bool preload = true,
    int? initialIndex,
    Duration? initialPosition,
  }) async {
    final uri = (source as UriAudioSource).uri;
    calls.add('source $uri ${initialPosition?.inSeconds}');
    return const Duration(seconds: 30);
  }

  @override
  Future<void> play() {
    calls.add('play');
    // just_audio completes play() only when playing stops.
    return playEnded.future;
  }

  @override
  Future<void> pause() async => calls.add('pause');

  @override
  Future<void> stop() async => calls.add('stop');

  @override
  Future<void> seek(Duration? position, {int? index}) async {
    calls.add('seek ${position?.inSeconds}');
  }

  @override
  Future<void> setSpeed(double speed) async => calls.add('speed $speed');

  @override
  Future<void> dispose() async => calls.add('dispose');
}

void main() {
  test('creates the just_audio player on first use only', () async {
    var created = 0;
    final player = JustAudioFilePlayer(
      create: () {
        created++;
        return _FakeAudioPlayer();
      },
    );
    expect(created, 0);
    await player.dispose();
    expect(created, 0);
    await player.stop();
    await player.pause();
    expect(created, 1);
  });

  test('passes every command to just_audio', () async {
    final fake = _FakeAudioPlayer();
    final player = JustAudioFilePlayer(create: () => fake);
    final url = Uri.parse('https://audio.test/a.mp3');

    expect(
      await player.load(url, start: const Duration(seconds: 4)),
      const Duration(seconds: 30),
    );
    // play() returns once playing starts, though just_audio's does not.
    await player.play();
    await player.pause();
    await player.seek(const Duration(seconds: 9));
    await player.setSpeed(1.5);
    await player.stop();
    await player.dispose();

    expect(fake.calls, [
      'source $url 4',
      'play',
      'pause',
      'seek 9',
      'speed 1.5',
      'stop',
      'dispose',
    ]);
    expect(player.position, const Duration(seconds: 7));
  });

  test('reports completion, errors and positions', () async {
    final fake = _FakeAudioPlayer();
    final player = JustAudioFilePlayer(create: () => fake);
    var completed = 0;
    final failures = <Object>[];
    final positions = <Duration>[];
    player.completed.listen((_) => completed++);
    player.failed.listen(failures.add);
    player.positions.listen(positions.add);

    fake.states
      ..add(ProcessingState.loading)
      ..add(ProcessingState.ready)
      ..add(ProcessingState.completed);
    final error = PlayerException(0, 'dropped', null);
    fake.errors.add(error);
    fake.positions.add(const Duration(seconds: 2));
    await Future<void>.delayed(Duration.zero);

    expect(completed, 1);
    expect(failures, [error]);
    expect(positions, [const Duration(seconds: 2)]);
  });

  test('builds a real just_audio player by default', () {
    expect(JustAudioFilePlayer.new, returnsNormally);
  });
}
