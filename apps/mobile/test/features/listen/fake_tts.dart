import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_tts/flutter_tts.dart';

/// A flutter_tts plugin that records calls; tests fire its handlers.
class FakeTts extends Fake implements FlutterTts {
  /// Every call, in order, for example `shared true` or `speak One.`.
  final List<String> calls = [];

  /// The start handler the engine set.
  VoidCallback? onStart;

  /// The completion handler the engine set.
  VoidCallback? onComplete;

  /// The error handler the engine set.
  ErrorHandler? onError;

  /// Voices that fail to be set.
  Set<String> missingLanguages = {};

  /// The voices the device has.
  Set<String> voices = {'en-GB', 'sw-TZ'};

  /// What [speak] answers: `1` when queued, `0` when not.
  Object? speakResult = 1;

  @override
  Future<dynamic> isLanguageAvailable(String language) async {
    calls.add('available $language');
    return voices.contains(language);
  }

  @override
  void setStartHandler(VoidCallback callback) => onStart = callback;

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
    return speakResult;
  }

  @override
  Future<dynamic> stop() async => calls.add('stop');

  /// The calls that touch the audio session.
  Iterable<String> get sessionCalls => calls.where(
    (call) => call.startsWith('shared') || call.startsWith('category'),
  );
}
