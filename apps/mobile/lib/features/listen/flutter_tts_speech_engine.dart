import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_tts/flutter_tts.dart';
import 'package:lectio/features/listen/listen_players.dart';
import 'package:lectio/features/listen/locale.dart';

/// flutter_tts's normal rate: `0.5` on both Android and iOS (the plugin
/// doubles it for Android's engine).
const double normalSpeechRate = 0.5;

/// The flutter_tts rate for a playing [speed] (`1` is normal), capped at
/// the plugin's maximum of `1`.
double speechRate(double speed) {
  final rate = normalSpeechRate * speed;
  return rate > 1 ? 1 : rate;
}

/// [SpeechEngine] on flutter_tts, the fallback for segments whose audio file
/// is not rendered yet.
///
/// The plugin is created and set up on the first [speak]: on iOS it shares
/// the app's audio session in the playback category, so the device voice
/// goes on with the screen locked, as files do.
class FlutterTtsSpeechEngine implements SpeechEngine {
  /// Creates the engine; [create] builds the plugin (default:
  /// `FlutterTts()`) and [platform] tells which platform runs (default:
  /// [defaultTargetPlatform]).
  new({FlutterTts Function()? create, TargetPlatform Function()? platform})
    : _create = create ?? FlutterTts.new,
      _platform = platform ?? (() => defaultTargetPlatform);

  final FlutterTts Function() _create;
  final TargetPlatform Function() _platform;
  final StreamController<void> _completed = StreamController.broadcast();
  final StreamController<Object> _failed = StreamController.broadcast();
  FlutterTts? _tts;
  Future<FlutterTts>? _ready;
  String? _language;

  @override
  Stream<void> get completed => _completed.stream;

  @override
  Stream<Object> get failed => _failed.stream;

  Future<FlutterTts> _setUp() => _ready ??= _initialise();

  Future<FlutterTts> _initialise() async {
    final tts = _tts = _create()
      ..setCompletionHandler(() => _completed.add(null))
      ..setErrorHandler(
        (message) => _failed.add((message as Object?) ?? 'error'),
      );
    if (_platform() == TargetPlatform.iOS) {
      await tts.setSharedInstance(true);
      await tts.setIosAudioCategory(IosTextToSpeechAudioCategory.playback, [
        IosTextToSpeechAudioCategoryOptions.allowBluetooth,
        IosTextToSpeechAudioCategoryOptions.allowBluetoothA2DP,
        IosTextToSpeechAudioCategoryOptions.allowAirPlay,
      ]);
    }
    return tts;
  }

  @override
  Future<bool> canSpeak(String locale) async {
    final voices = FlutterTtsVoices(tts: await _setUp());
    for (final tag in NarrationLocale.of(locale).voices) {
      if (await voices.isLanguageAvailable(tag)) return true;
    }
    return false;
  }

  @override
  Future<void> speak(
    String text, {
    required String locale,
    required double speed,
  }) async {
    final tts = await _setUp();
    if (locale != _language) {
      // The best voice for the language (sw-KE, then sw-TZ …), else an
      // English one; the queue plays English instead of Kiswahili text
      // when the device has no Kiswahili voice (ListenSegment.fallback).
      try {
        await useVoiceFor(
          NarrationLocale.of(locale),
          FlutterTtsVoices(tts: tts),
        );
        _language = locale;
      } on Exception catch (error) {
        // The device keeps its own voice.
        debugPrint('Listen: no device voice for $locale ($error)');
      }
    }
    await tts.setSpeechRate(speechRate(speed));
    await tts.speak(text);
  }

  @override
  Future<void> stop() async {
    await _tts?.stop();
  }

  @override
  Future<void> dispose() async {
    await stop();
    await _completed.close();
    await _failed.close();
  }
}
