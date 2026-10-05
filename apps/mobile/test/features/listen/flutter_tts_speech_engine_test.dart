import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_tts/flutter_tts.dart';
import 'package:lectio/features/listen/flutter_tts_speech_engine.dart';

class _FakeTts extends Fake implements FlutterTts {
  final List<String> calls = [];
  VoidCallback? onComplete;
  ErrorHandler? onError;
  Set<String> missingLanguages = {};
  Set<String> voices = {'en-GB', 'sw-TZ'};

  @override
  Future<dynamic> isLanguageAvailable(String language) async {
    return voices.contains(language);
  }

  @override
  void setCompletionHandler(VoidCallback callback) => onComplete = callback;

  @override
  void setErrorHandler(ErrorHandler handler) => onError = handler;

  @override
  Future<dynamic> setSharedInstance(bool sharedSession) async {
    calls.add('shared $sharedSession');
  }

  @override
  Future<dynamic> setIosAudioCategory(
    IosTextToSpeechAudioCategory category,
    List<IosTextToSpeechAudioCategoryOptions> options, [
    IosTextToSpeechAudioMode mode = IosTextToSpeechAudioMode.defaultMode,
  ]) async {
    calls.add('category ${category.name}');
  }

  @override
  Future<dynamic> setLanguage(String language) async {
    calls.add('language $language');
    if (missingLanguages.contains(language)) {
      throw PlatformException(code: 'language');
    }
  }

  @override
  Future<dynamic> setSpeechRate(double rate) async => calls.add('rate $rate');

  @override
  Future<dynamic> speak(String text, {bool focus = false}) async {
    calls.add('speak $text');
  }

  @override
  Future<dynamic> stop() async => calls.add('stop');
}

void main() {
  test('speechRate scales the normal rate and caps it', () {
    expect(speechRate(1), 0.5);
    expect(speechRate(0.75), 0.375);
    expect(speechRate(1.5), 0.75);
    expect(speechRate(2), 1);
  });

  test('sets up once, on the first utterance, and speaks', () async {
    var created = 0;
    final tts = _FakeTts();
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
    expect(tts.calls, [
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
  });

  test('shares the playback session on iOS', () async {
    final tts = _FakeTts();
    final engine = FlutterTtsSpeechEngine(
      create: () => tts,
      platform: () => TargetPlatform.iOS,
    );
    await engine.speak('One.', locale: 'en', speed: 1);
    expect(tts.calls.take(2), ['shared true', 'category playback']);
  });

  test('keeps the device voice when setting one fails', () async {
    final tts = _FakeTts()..missingLanguages.add('sw-TZ');
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
    final tts = _FakeTts();
    final engine = FlutterTtsSpeechEngine(create: () => tts);
    expect(await engine.canSpeak('sw'), isTrue);
    expect(await engine.canSpeak('en'), isTrue);
    tts.voices = {'en-US'};
    expect(await engine.canSpeak('sw'), isFalse);
    expect(await engine.canSpeak('en'), isTrue);
  });

  test('reports completions and errors', () async {
    final tts = _FakeTts();
    final engine = FlutterTtsSpeechEngine(create: () => tts);
    var completed = 0;
    final failures = <Object>[];
    engine.completed.listen((_) => completed++);
    engine.failed.listen(failures.add);
    await engine.speak('One.', locale: 'en', speed: 1);

    tts.onComplete!();
    tts.onError!('synthesis');
    tts.onError!(null);
    await Future<void>.delayed(Duration.zero);

    expect(completed, 1);
    expect(failures, ['synthesis', 'error']);
    await engine.dispose();
    expect(tts.calls.last, 'stop');
  });

  test('builds the real plugin by default', () {
    expect(FlutterTtsSpeechEngine.new, returnsNormally);
  });
}
