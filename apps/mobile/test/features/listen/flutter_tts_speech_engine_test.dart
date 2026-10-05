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
      tts.onComplete!();
      await Future<void>.delayed(Duration.zero);
      expect(completed, 0);
      expect(failures, isEmpty);

      tts
        ..onStart!()
        ..onComplete!()
        ..onComplete!()
        ..onError!('late');
      await Future<void>.delayed(Duration.zero);
      expect(completed, 1);
      expect(failures, isEmpty);
    });

    test('an error before the start fails the utterance, once', () async {
      tts
        ..onError!('synthesis')
        ..onError!('again');
      await Future<void>.delayed(Duration.zero);
      expect(failures, ['synthesis']);

      await engine.speak('Two.', locale: 'en', speed: 1);
      await engine.stop();
      tts.onError!('stopped');
      await Future<void>.delayed(Duration.zero);
      expect(failures, ['synthesis']);
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

  test('builds the real plugin by default', () {
    expect(FlutterTtsSpeechEngine.new, returnsNormally);
  });
}
