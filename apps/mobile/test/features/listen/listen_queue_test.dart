import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:lectio/features/listen/listen_queue.dart';
import 'package:lectio/features/listen/listen_segment.dart';

import 'fake_players.dart';

void main() {
  late FakeAudioFilePlayer player;
  late FakeSpeechEngine speech;
  late ListenQueue queue;
  var prepared = 0;

  setUp(() {
    player = FakeAudioFilePlayer();
    speech = FakeSpeechEngine();
    prepared = 0;
    queue = ListenQueue(
      player: player,
      speech: speech,
      beforeFirstPlay: (_) async => prepared++,
    );
  });

  final mixed = [
    testSegment(0, seconds: 74.5),
    testSegment(1),
    testSegment(2, audio: false),
  ];

  group('loading', () {
    test('starts idle and empty', () async {
      expect(queue.status, ListenStatus.idle);
      expect(queue.current, isNull);
      expect(queue.queueId, isNull);
      expect(queue.position, Duration.zero);
      await queue.play();
      await queue.previous();
      expect(player.calls, isEmpty);
      expect(prepared, 0);
    });

    test('loads segments ready to play the first', () async {
      var notified = 0;
      queue.addListener(() => notified++);
      await queue.load('2026-09-20/day', mixed);

      expect(queue.queueId, '2026-09-20/day');
      expect(queue.segments.map((s) => s.id), mixed.map((s) => s.id));
      expect(queue.index, 0);
      expect(queue.current, mixed.first);
      expect(queue.status, ListenStatus.idle);
      expect(notified, 1);
      expect(player.calls, isEmpty);
    });

    test('holds compares the id and every segment id', () async {
      await queue.load('a', mixed);
      expect(queue.holds('a', mixed), isTrue);
      expect(queue.holds('b', mixed), isFalse);
      expect(queue.holds('a', mixed.sublist(1)), isFalse);
      expect(queue.holds('a', [mixed[1], mixed[0], mixed[2]]), isFalse);
    });

    test('reloading the same queue keeps the place and the sound', () async {
      await queue.load('a', mixed);
      await queue.skipTo(1);
      final calls = player.calls.length;

      final refreshed = [testSegment(0), testSegment(1), testSegment(2)];
      await queue.load('a', refreshed);

      expect(queue.index, 1);
      expect(queue.status, ListenStatus.playing);
      expect(player.calls.length, calls);
      expect(queue.segments[2].usesSpeech, isFalse);
    });

    test('loading another queue stops what plays', () async {
      await queue.load('a', mixed);
      await queue.skipTo(1);
      await queue.load('b', [testSegment(5)]);

      expect(queue.status, ListenStatus.idle);
      expect(queue.index, 0);
      expect(queue.queueId, 'b');
      expect(player.calls.last, 'stop');
    });
  });

  group('playing files', () {
    test('plays the first file at the queue speed', () async {
      await queue.setSpeed(1.5);
      await queue.load('a', mixed);
      await queue.play();

      expect(prepared, 1);
      expect(player.calls, ['load ${testUrl(0)}', 'speed 1.5', 'play']);
      expect(queue.status, ListenStatus.playing);
      expect(queue.active, isTrue);
      expect(queue.speaking, isFalse);
      expect(queue.duration, const Duration(seconds: 60));
    });

    test('keeps the API duration when the file does not say', () async {
      player.length = null;
      await queue.load('a', mixed);
      await queue.play();
      expect(queue.duration, const Duration(milliseconds: 74500));
    });

    test(
      'plays the queue in order, the device voice reading the gap',
      () async {
        await queue.load('a', mixed);
        await queue.play();

        player.complete();
        await settle();
        expect(queue.index, 1);
        expect(player.calls.last, 'play');
        expect(player.calls, contains('load ${testUrl(1)}'));

        player.complete();
        await settle();
        expect(queue.index, 2);
        expect(queue.speaking, isTrue);
        expect(queue.duration, isNull);
        expect(speech.calls.last, 'speak en 1.0 Script 2.');
        expect(player.calls.last, 'stop');

        speech.complete();
        await settle();
        expect(queue.status, ListenStatus.completed);
        expect(queue.active, isFalse);
        expect(queue.index, 2);
      },
    );

    test('ignores a completion while paused', () async {
      await queue.load('a', mixed);
      await queue.play();
      await queue.pause();
      player.complete();
      speech.complete();
      await settle();
      expect(queue.index, 0);
      expect(queue.status, ListenStatus.paused);
    });

    test('pauses and resumes a file where it was', () async {
      await queue.load('a', mixed);
      await queue.play();
      player.moveTo(const Duration(seconds: 12));

      await queue.pause();
      expect(queue.status, ListenStatus.paused);
      expect(player.calls.last, 'pause');
      expect(queue.position, const Duration(seconds: 12));

      player.calls.clear();
      await queue.play();
      expect(player.calls, ['play']);
      expect(queue.status, ListenStatus.playing);
    });

    test('toggle pauses and plays', () async {
      await queue.load('a', mixed);
      await queue.toggle();
      expect(queue.status, ListenStatus.playing);
      await queue.toggle();
      expect(queue.status, ListenStatus.paused);
      await queue.pause();
      expect(queue.status, ListenStatus.paused);
    });

    test('play does nothing while playing', () async {
      await queue.load('a', mixed);
      await queue.play();
      player.calls.clear();
      await queue.play();
      expect(player.calls, isEmpty);
    });

    test('plays again from the start after the end', () async {
      await queue.load('a', [testSegment(0)]);
      await queue.play();
      player.complete();
      await settle();
      expect(queue.status, ListenStatus.completed);

      await queue.play();
      expect(queue.index, 0);
      expect(queue.status, ListenStatus.playing);
      expect(player.calls.last, 'play');
    });

    test('seeks in a file and changes its speed at once', () async {
      await queue.load('a', mixed);
      await queue.play();
      await queue.seek(const Duration(seconds: 30));
      await queue.setSpeed(2);
      await queue.setSpeed(2);

      expect(player.calls.sublist(3), ['seek 30', 'speed 2.0']);
      expect(queue.position, const Duration(seconds: 30));
      expect(queue.speed, 2);
    });

    test('a file that will not load is read by the device voice', () async {
      player.broken.add(testUrl(0));
      await queue.load('a', mixed);
      await queue.play();

      expect(queue.speaking, isTrue);
      expect(queue.status, ListenStatus.playing);
      expect(speech.calls, ['speak en 1.0 Script 0.']);
    });

    test('a file that fails while playing is read instead', () async {
      await queue.load('a', mixed);
      await queue.play();
      player.fail();
      await settle();

      expect(queue.speaking, isTrue);
      expect(player.calls.last, 'stop');
      expect(speech.calls, ['speak en 1.0 Script 0.']);
      expect(queue.status, ListenStatus.playing);
    });

    test('a failure while paused or after the switch is ignored', () async {
      await queue.load('a', mixed);
      await queue.play();
      await queue.pause();
      player.fail();
      await settle();
      expect(queue.speaking, isFalse);

      await queue.skipTo(2);
      player.fail();
      await settle();
      expect(speech.calls, hasLength(1));
    });

    test('the positions stream is the player', () async {
      final seen = <Duration>[];
      final subscription = queue.positions.listen(seen.add);
      player.moveTo(const Duration(seconds: 3));
      await subscription.cancel();
      expect(seen, [const Duration(seconds: 3)]);
    });
  });

  group('device voice', () {
    final spoken = [testSegment(0, audio: false), testSegment(1, audio: false)];

    test('reads the script in its locale at the queue speed', () async {
      await queue.setSpeed(1.25);
      await queue.load('a', spoken);
      await queue.play();

      expect(speech.calls, ['speak en 1.25 Script 0.']);
      expect(player.calls, isEmpty);
      expect(queue.position, Duration.zero);
    });

    test('pausing stops the voice; resuming reads the segment again', () async {
      await queue.load('a', spoken);
      await queue.play();
      await queue.pause();
      expect(speech.calls.last, 'stop');

      await queue.play();
      expect(speech.calls.last, 'speak en 1.0 Script 0.');
      expect(queue.status, ListenStatus.playing);
    });

    test('a new speed applies from the next utterance', () async {
      await queue.load('a', spoken);
      await queue.play();
      await queue.setSpeed(2);
      expect(speech.calls, hasLength(1));

      speech.complete();
      await settle();
      expect(speech.calls.last, 'speak en 2.0 Script 1.');
    });

    test('an utterance the device cannot read is skipped', () async {
      await queue.load('a', spoken);
      await queue.play();
      speech.fail();
      await settle();
      expect(queue.index, 1);
    });

    test('a voice that throws skips to the end', () async {
      speech.throws = true;
      await queue.load('a', spoken);
      await queue.play();
      await settle();
      expect(queue.status, ListenStatus.completed);
    });
  });

  group('skipping', () {
    test('next plays the next segment; nothing at the last', () async {
      await queue.load('a', mixed);
      await queue.next();
      expect(queue.index, 1);
      expect(queue.status, ListenStatus.playing);

      await queue.next();
      await queue.next();
      expect(queue.index, 2);
    });

    test('previous goes back early in a segment', () async {
      await queue.load('a', mixed);
      await queue.skipTo(1);
      player.moveTo(const Duration(seconds: 2));
      await queue.previous();
      expect(queue.index, 0);
    });

    test('previous restarts a file past the threshold', () async {
      await queue.load('a', mixed);
      await queue.skipTo(1);
      player.moveTo(const Duration(seconds: 10));
      player.calls.clear();
      await queue.previous();
      expect(queue.index, 1);
      expect(player.calls, contains('load ${testUrl(1)}'));
    });

    test('previous at the first segment restarts it', () async {
      await queue.load('a', mixed);
      await queue.play();
      await queue.previous();
      expect(queue.index, 0);
      expect(queue.status, ListenStatus.playing);
    });

    test('skipTo ignores an index out of range', () async {
      await queue.load('a', mixed);
      await queue.skipTo(-1);
      await queue.skipTo(3);
      expect(queue.status, ListenStatus.idle);
      expect(player.calls, isEmpty);
    });

    test('skipping from the device voice stops it', () async {
      await queue.load('a', mixed);
      await queue.skipTo(2);
      await queue.skipTo(0);
      expect(speech.calls.last, 'stop');
      expect(queue.speaking, isFalse);
    });

    test('the newest skip wins over a slow load', () async {
      await queue.load('a', mixed);
      final gate = player.loadGate = Completer<void>();
      final first = queue.skipTo(0);
      expect(queue.status, ListenStatus.loading);
      final second = queue.skipTo(2);
      gate.complete();
      await Future.wait([first, second]);

      expect(queue.index, 2);
      expect(queue.speaking, isTrue);
      expect(player.calls.where((call) => call == 'play'), isEmpty);
    });
  });

  group('pausing while loading', () {
    test('a file loads but waits for play', () async {
      await queue.load('a', mixed);
      final gate = player.loadGate = Completer<void>();
      final started = queue.play();
      await queue.pause();
      gate.complete();
      await started;

      expect(queue.status, ListenStatus.paused);
      expect(player.calls, isNot(contains('play')));

      player.loadGate = null;
      await queue.play();
      expect(player.calls.last, 'play');
    });

    test('a file that fails to load waits for play to speak', () async {
      player.broken.add(testUrl(0));
      await queue.load('a', mixed);
      final gate = player.loadGate = Completer<void>();
      final started = queue.play();
      await queue.pause();
      gate.complete();
      await started;

      expect(queue.status, ListenStatus.paused);
      expect(queue.speaking, isTrue);
      expect(speech.calls, isEmpty);

      await queue.play();
      expect(speech.calls.last, 'speak en 1.0 Script 0.');
    });

    test('a paused queue that never loaded loads on play', () async {
      await queue.load('a', mixed);
      final gate = player.loadGate = Completer<void>();
      final started = queue.play();
      await queue.pause();
      player.loadGate = null;
      await queue.play();
      gate.complete();
      await started;

      expect(queue.status, ListenStatus.playing);
      expect(player.calls.where((call) => call == 'play'), hasLength(1));
    });
  });

  group('a language the device cannot speak', () {
    // A Kiswahili note without a recording, and its English original.
    ListenSegment swahili({bool englishAudio = true, bool audio = false}) {
      return testSegment(
        1,
        audio: audio,
        locale: 'sw',
        fallback: testSegment(0, audio: englishAudio, seconds: 30),
      );
    }

    test('is read by its own voice when the device has one', () async {
      await queue.load('a', [swahili()]);
      await queue.play();
      expect(speech.calls, ['speak sw 1.0 Script 1.']);
      expect(queue.fallingBack, isFalse);
      expect(player.calls, isEmpty);
    });

    test('plays the English recording instead', () async {
      speech.voices = {'en'};
      await queue.load('a', [swahili()]);
      await queue.play();

      expect(queue.fallingBack, isTrue);
      expect(queue.speaking, isFalse);
      expect(player.calls, ['load ${testUrl(0)}', 'speed 1.0', 'play']);
      expect(speech.calls, isEmpty);
    });

    test('reads the English note when it has no recording either', () async {
      speech.voices = {'en'};
      await queue.load('a', [swahili(englishAudio: false)]);
      await queue.play();

      expect(queue.fallingBack, isTrue);
      expect(queue.speaking, isTrue);
      expect(speech.calls, ['speak en 1.0 Script 0.']);
    });

    test('asks about each language once', () async {
      speech.voices = {'en'};
      await queue.load('a', [swahili(), swahili()]);
      await queue.play();
      await queue.next();
      expect(speech.asked, ['sw']);
      expect(await queue.canSpeak('sw'), isFalse);
      expect(speech.asked, ['sw']);
    });

    test('forgetVoices asks again', () async {
      speech.voices = {'en'};
      expect(await queue.canSpeak('sw'), isFalse);
      speech.voices = {'en', 'sw'};
      expect(await queue.canSpeak('sw'), isFalse);
      queue.forgetVoices();
      expect(await queue.canSpeak('sw'), isTrue);
      expect(speech.asked, ['sw', 'sw']);
    });

    test('a device that cannot say counts as able', () async {
      speech.voiceCheckThrows = true;
      await queue.load('a', [swahili()]);
      await queue.play();
      expect(queue.fallingBack, isFalse);
      expect(speech.calls, ['speak sw 1.0 Script 1.']);
    });

    test('a Kiswahili recording that fails falls back to English', () async {
      speech.voices = {'en'};
      await queue.load('a', [swahili(audio: true)]);
      await queue.play();
      expect(queue.fallingBack, isFalse);

      player.fail();
      await settle();
      expect(queue.fallingBack, isTrue);
      expect(player.calls.last, 'play');
      expect(player.calls, contains('load ${testUrl(0)}'));
    });

    test('an English recording that fails is read in English', () async {
      speech.voices = {'en'};
      await queue.load('a', [swahili()]);
      await queue.play();
      player.fail();
      await settle();
      expect(queue.fallingBack, isTrue);
      expect(speech.calls, ['speak en 1.0 Script 0.']);
    });

    test('a skip while asking wins', () async {
      speech.voices = {'en'};
      await queue.load('a', [swahili(), testSegment(2, audio: false)]);
      final first = queue.play();
      final second = queue.skipTo(1);
      await Future.wait([first, second]);
      expect(queue.index, 1);
      expect(queue.fallingBack, isFalse);
      expect(player.calls, isEmpty);
      expect(speech.calls, ['speak en 1.0 Script 2.']);
    });
  });

  test('stop goes back to idle at the same segment', () async {
    await queue.load('a', mixed);
    await queue.skipTo(1);
    await queue.stop();
    expect(queue.status, ListenStatus.idle);
    expect(queue.index, 1);
    expect(player.calls.last, 'stop');
  });

  test('a failing beforeFirstPlay still plays, and runs once', () async {
    var calls = 0;
    final failing = ListenQueue(
      player: player,
      speech: speech,
      beforeFirstPlay: (_) async {
        calls++;
        throw Exception('no background audio');
      },
    );
    await failing.load('a', mixed);
    await failing.play();
    await failing.next();
    expect(calls, 1);
    expect(failing.status, ListenStatus.playing);
  });

  test('dispose releases both players', () async {
    await queue.load('a', mixed);
    await queue.play();
    queue.dispose();
    await settle();
    expect(player.disposed, isTrue);
    expect(speech.disposed, isTrue);
  });
}
