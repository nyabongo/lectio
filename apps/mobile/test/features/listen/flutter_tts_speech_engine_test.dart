import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lectio/features/listen/flutter_tts_speech_engine.dart';

import 'fake_tts.dart';

void main() {
  group('speechRate', () {
    test('scales the normal rate on Android and caps it', () {
      const android = TargetPlatform.android;
      expect(speechRate(1, platform: android), 0.5);
      expect(speechRate(0.75, platform: android), 0.375);
      expect(speechRate(1.5, platform: android), 0.75);
      expect(speechRate(2, platform: android), 1);
    });

    test('rises gently above normal on iOS', () {
      const ios = TargetPlatform.iOS;
      expect(speechRate(0.75, platform: ios), 0.375);
      expect(speechRate(1, platform: ios), 0.5);
      expect(speechRate(1.5, platform: ios), closeTo(0.6, 1e-9));
      expect(speechRate(2, platform: ios), closeTo(0.7, 1e-9));
      expect(speechRate(4, platform: ios), 1);
    });

    test('defaults to the running platform', () {
      expect(speechRate(2), 1);
    });
  });

  test('creates the plugin once, on first use, and speaks', () async {
    var created = 0;
    final tts = FakeTts();
    final engine = FlutterTtsSpeechEngine(
      create: () {
        created++;
        return tts;
      },
      platform: () => TargetPlatform.android,
    );
    await engine.stop();
    expect(created, 0);

    await engine.speak('One.', locale: 'en', speed: 1);
    await engine.speak('Two.', locale: 'en', speed: 2);
    await engine.speak('Moja.', locale: 'sw', speed: 1);
    await engine.stop();

    expect(created, 1);
    expect(tts.calls.where((call) => !call.startsWith('available')), [
      'language en-GB',
      'rate 0.5',
      'speak One.',
      'rate 1.0',
      'speak Two.',
      'language sw-TZ',
      'rate 0.5',
      'speak Moja.',
      'stop',
    ]);
    expect(tts.sessionCalls, isEmpty);
  });

  group('on iOS', () {
    late FakeTts tts;
    late FlutterTtsSpeechEngine engine;

    setUp(() {
      tts = FakeTts();
      engine = FlutterTtsSpeechEngine(
        create: () => tts,
        platform: () => TargetPlatform.iOS,
      );
    });

    test('canSpeak leaves the audio session alone', () async {
      expect(await engine.canSpeak('sw'), isTrue);
      expect(tts.sessionCalls, isEmpty);
    });

    test('the first utterance takes the playback session, once', () async {
      await engine.speak('One.', locale: 'en', speed: 1);
      await engine.speak('Two.', locale: 'en', speed: 2);
      expect(tts.calls.take(2), ['shared true', 'category playback']);
      expect(tts.sessionCalls, hasLength(2));
      expect(tts.calls, contains('rate 0.7'));
    });
  });

  test('keeps the device voice when setting one fails', () async {
    final tts = FakeTts()..missingLanguages.add('sw-TZ');
    final engine = FlutterTtsSpeechEngine(create: () => tts);
    await engine.speak('Moja.', locale: 'sw', speed: 1);
    await engine.speak('Mbili.', locale: 'sw', speed: 1);
    expect(tts.calls.where((call) => call.startsWith('language')), [
      'language sw-TZ',
      'language sw-TZ',
    ]);
    expect(tts.calls.last, 'speak Mbili.');
  });

  test('canSpeak looks for a voice of the language', () async {
    final tts = FakeTts();
    final engine = FlutterTtsSpeechEngine(create: () => tts);
    expect(await engine.canSpeak('sw'), isTrue);
    expect(await engine.canSpeak('en'), isTrue);
    tts.voices = {'en-US'};
    expect(await engine.canSpeak('sw'), isFalse);
    expect(await engine.canSpeak('en'), isTrue);
  });

  test('an utterance the device does not queue fails', () async {
    final tts = FakeTts()..speakResult = 0;
    final engine = FlutterTtsSpeechEngine(create: () => tts);
    await expectLater(
      engine.speak('One.', locale: 'en', speed: 1),
      throwsException,
    );
  });

  group('events', () {
    late FakeTts tts;
    late FlutterTtsSpeechEngine engine;
    late int completed;
    late List<Object> failures;

    setUp(() async {
      tts = FakeTts();
      engine = FlutterTtsSpeechEngine(create: () => tts);
      completed = 0;
      failures = [];
      engine.completed.listen((_) => completed++);
      engine.failed.listen(failures.add);
      await engine.speak('One.', locale: 'en', speed: 1);
    });

    tearDown(() => engine.dispose());

    test('reports the completion and errors of a started utterance', () async {
      tts
        ..onStart!()
        ..onComplete!()
        ..onStart!()
        ..onError!('synthesis')
        ..onStart!()
        ..onError!(null);
      await Future<void>.delayed(Duration.zero);

      expect(completed, 1);
      expect(failures, ['synthesis', 'error']);
      await engine.dispose();
      expect(tts.calls.last, 'stop');
    });

    test('drops late events of a stopped utterance', () async {
      tts.onStart!();
      await engine.stop();
      tts
        ..onComplete!()
        ..onError!('interrupted');
      await engine.speak('Two.', locale: 'en', speed: 1);
      tts.onError!('interrupted');
      await Future<void>.delayed(Duration.zero);
      expect(completed, 0);
      expect(failures, isEmpty);

      tts
        ..onStart!()
        ..onComplete!()
        ..onComplete!();
      await Future<void>.delayed(Duration.zero);
      expect(completed, 1);
    });

    test('a late interrupted error after a stop does not end the next '
        'utterance', () async {
      tts.onStart!();
      await engine.stop();
      await engine.speak('Two.', locale: 'en', speed: 1);
      tts.onError!('Error from TextToSpeech (speak) - interrupted');
      await Future<void>.delayed(Duration.zero);
      expect(failures, isEmpty);

      tts
        ..onStart!()
        ..onComplete!();
      await Future<void>.delayed(Duration.zero);
      expect(completed, 1);
    });

    test('a late error of a stopped utterance is not charged to the next '
        'one', () async {
      tts.onStart!();
      await engine.stop();
      await engine.speak('Two.', locale: 'en', speed: 1);
      tts.onError!('synthesis');
      await Future<void>.delayed(Duration.zero);
      expect(failures, isEmpty);

      tts.onError!('synthesis');
      await Future<void>.delayed(Duration.zero);
      expect(failures, ['synthesis']);
    });

    test('an error before the start fails the utterance, once', () async {
      tts
        ..onError!('synthesis')
        ..onError!('again');
      await Future<void>.delayed(Duration.zero);
      expect(failures, ['synthesis']);
    });

    test('a stale completion followed by a real pre-start error still '
        'fails', () async {
      tts.onStart!();
      await engine.stop();
      await engine.speak('Two.', locale: 'en', speed: 1);
      tts
        ..onComplete!()
        ..onError!('synthesis');
      await Future<void>.delayed(Duration.zero);
      expect(completed, 0);
      expect(failures, ['synthesis']);
    });

    test('a cancel pays for the stopped utterance and ends none', () async {
      tts
        ..onStart!()
        ..onCancel!();
      await engine.stop();
      tts.onCancel!();
      await engine.speak('Two.', locale: 'en', speed: 1);
      tts.onError!('synthesis');
      await Future<void>.delayed(Duration.zero);
      expect(failures, ['synthesis']);
      expect(completed, 0);
    });

    test('replacing an utterance drops its late end; a start clears what '
        'is owed', () async {
      tts.onStart!();
      await engine.speak('Two.', locale: 'en', speed: 1);
      tts.onComplete!();
      await Future<void>.delayed(Duration.zero);
      expect(completed, 0);

      await engine.stop();
      await engine.speak('Three.', locale: 'en', speed: 1);
      tts
        ..onStart!()
        ..onComplete!();
      await Future<void>.delayed(Duration.zero);
      expect(completed, 1);
    });

    test('an utterance the device refuses expects no error', () async {
      tts.speakResult = 0;
      await expectLater(
        engine.speak('Two.', locale: 'en', speed: 1),
        throwsException,
      );
      tts.onError!('refused');
      await Future<void>.delayed(Duration.zero);
      expect(failures, isEmpty);
    });
  });

  group('start watchdog', () {
    late FakeTts tts;
    late FlutterTtsSpeechEngine engine;
    late List<Object> failures;
    late int stalls;

    setUp(() {
      tts = FakeTts();
      engine = FlutterTtsSpeechEngine(
        create: () => tts,
        startTimeout: const Duration(milliseconds: 20),
      );
      failures = [];
      stalls = 0;
      engine.failed.listen(failures.add);
      engine.stalled.listen((_) => stalls++);
    });

    tearDown(() => engine.dispose());

    Future<void> wait() =>
        Future<void>.delayed(const Duration(milliseconds: 60));

    test('fails an utterance when the device has never spoken', () async {
      await engine.speak('One.', locale: 'en', speed: 1);
      await wait();
      expect(failures, ['The device voice did not start']);
      expect(stalls, 0);
      expect(tts.calls.last, 'stop');

      // The stopped utterance's cancel pays for it; the next error is the
      // next utterance's.
      await engine.speak('Two.', locale: 'en', speed: 1);
      tts
        ..onCancel!()
        ..onError!('synthesis');
      await Future<void>.delayed(Duration.zero);
      expect(failures, ['The device voice did not start', 'synthesis']);
    });

    test('reports a stall once the device has spoken', () async {
      await engine.speak('One.', locale: 'en', speed: 1);
      tts
        ..onStart!()
        ..onComplete!();
      await wait();
      expect(failures, isEmpty);

      await engine.speak('Two.', locale: 'en', speed: 1);
      await wait();
      expect(stalls, 1);
      expect(failures, isEmpty);
    });

    test('stands down when the utterance starts, fails or stops', () async {
      await engine.speak('One.', locale: 'en', speed: 1);
      tts
        ..onStart!()
        ..onComplete!();
      await engine.speak('Two.', locale: 'en', speed: 1);
      tts.onError!('synthesis');
      await engine.speak('Three.', locale: 'en', speed: 1);
      await engine.stop();
      await wait();
      expect(stalls, 0);
      expect(failures, ['synthesis']);
    });

    test('does nothing after dispose', () async {
      await engine.speak('One.', locale: 'en', speed: 1);
      await engine.dispose();
      await wait();
      expect(failures, isEmpty);
    });
  });

  group('edge cases', () {
    late FakeTts tts;
    late FlutterTtsSpeechEngine engine;
    late int completed;
    late List<Object> failures;
    late int stalls;

    FlutterTtsSpeechEngine build({
      Duration startTimeout = const Duration(milliseconds: 20),
    }) {
      final made = FlutterTtsSpeechEngine(
        create: () => tts,
        startTimeout: startTimeout,
      );
      made.completed.listen((_) => completed++);
      made.failed.listen(failures.add);
      made.stalled.listen((_) => stalls++);
      return made;
    }

    setUp(() {
      tts = FakeTts();
      completed = 0;
      failures = [];
      stalls = 0;
      engine = build();
    });

    tearDown(() => engine.dispose());

    Future<void> wait() =>
        Future<void>.delayed(const Duration(milliseconds: 60));

    for (final (name, cancel) in <(String, void Function(FakeTts))>[
      ('an interrupted error', (fake) => fake.onError!('interrupted')),
      ('a cancel', (fake) => fake.onCancel!()),
    ]) {
      test('$name that ends a speaking utterance, with nothing owed, '
          'reports a stall', () async {
        await engine.speak('One.', locale: 'en', speed: 1);
        tts.onStart!();
        cancel(tts);
        await Future<void>.delayed(Duration.zero);
        expect(stalls, 1);
        expect(completed, 0);
        expect(failures, isEmpty);

        // The utterance is over: its late completion ends nothing, and
        // stopping it owes nothing, so the next error is the next one's.
        tts.onComplete!();
        await engine.stop();
        await engine.speak('Two.', locale: 'en', speed: 1);
        tts.onError!('synthesis');
        await Future<void>.delayed(Duration.zero);
        expect(completed, 0);
        expect(failures, ['synthesis']);
        expect(stalls, 1);
      });
    }

    test('a cancel before the start reports no stall', () async {
      await engine.speak('One.', locale: 'en', speed: 1);
      tts.onCancel!();
      await Future<void>.delayed(Duration.zero);
      expect(stalls, 0);
      expect(failures, isEmpty);
    });

    test('overlapping speaks leave one watchdog, the last one', () async {
      await engine.dispose();
      engine = build(startTimeout: const Duration(milliseconds: 100));
      tts.held['sw-TZ'] = Completer<void>();
      final clock = Stopwatch()..start();
      final elapsed = <Duration>[];
      engine.failed.listen((_) => elapsed.add(clock.elapsed));

      // The first speak sets its watchdog while the second still waits for
      // its voice; the second's watchdog then replaces the first's.
      final first = engine.speak('One.', locale: 'en', speed: 1);
      final second = engine.speak('Moja.', locale: 'sw', speed: 1);
      await first;
      await Future<void>.delayed(const Duration(milliseconds: 60));
      tts.held['sw-TZ']!.complete();
      await second;
      expect(tts.calls.last, 'speak Moja.');

      await Future<void>.delayed(const Duration(milliseconds: 250));
      expect(failures, ['The device voice did not start']);
      // Only the second watchdog barked, a full timeout after its speak.
      expect(
        elapsed.single,
        greaterThanOrEqualTo(const Duration(milliseconds: 160)),
      );
    });

    test('a late start after the watchdog stopped the utterance leaves no '
        'debt', () async {
      await engine.speak('One.', locale: 'en', speed: 1);
      await wait();
      expect(failures, ['The device voice did not start']);

      // The stopped utterance starts late, then its stop's cancel comes.
      tts
        ..onStart!()
        ..onCancel!();
      await Future<void>.delayed(Duration.zero);
      expect(stalls, 0);

      // The next utterance's genuine pre-start error fails it at once.
      await engine.speak('Two.', locale: 'en', speed: 1);
      tts.onError!('synthesis');
      await Future<void>.delayed(Duration.zero);
      expect(failures, ['The device voice did not start', 'synthesis']);

      // The late start showed the device can speak: the next stall pauses.
      await engine.speak('Three.', locale: 'en', speed: 1);
      await wait();
      expect(stalls, 1);
      expect(failures, hasLength(2));
    });

    test('a late start after its cancel leaves no debt either', () async {
      await engine.speak('One.', locale: 'en', speed: 1);
      await wait();
      tts
        ..onCancel!()
        ..onStart!();
      await engine.speak('Two.', locale: 'en', speed: 1);
      tts.onError!('synthesis');
      await Future<void>.delayed(Duration.zero);
      expect(failures, ['The device voice did not start', 'synthesis']);
      expect(stalls, 0);
    });

    test('the next utterance starts normally after a late start', () async {
      await engine.speak('One.', locale: 'en', speed: 1);
      await wait();
      tts.onStart!();
      await engine.speak('Two.', locale: 'en', speed: 1);
      tts
        ..onCancel!()
        ..onStart!()
        ..onComplete!();
      await Future<void>.delayed(Duration.zero);
      expect(completed, 1);
      expect(stalls, 0);
    });
  });

  test('builds the real plugin by default', () {
    expect(FlutterTtsSpeechEngine.new, returnsNormally);
  });
}
