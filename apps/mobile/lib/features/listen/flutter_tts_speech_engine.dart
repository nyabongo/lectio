import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_tts/flutter_tts.dart';
import 'package:lectio/features/listen/listen_players.dart';
import 'package:lectio/features/listen/locale.dart';

/// flutter_tts's normal rate: `0.5` on both Android and iOS (the plugin
/// doubles it for Android's engine).
const double normalSpeechRate = 0.5;

/// How much faster than normal iOS speaks at its maximum rate, `1`.
///
/// AVSpeechUtterance's rate is not linear: `0.5` is normal and `1` is far
/// more than twice as fast, so above normal each step of speed adds only a
/// fifth of the remaining range (2× is `0.7`, which sounds about twice as
/// fast).
const double iosRateStep = 0.2;

/// The flutter_tts rate for a playing [speed] (`1` is normal) on
/// [platform], capped at the plugin's maximum of `1`.
///
/// Android's engine is linear (the plugin doubles the rate, so `0.5 × speed`
/// plays at `speed`). iOS is linear below normal and much steeper above it,
/// so faster speeds use [iosRateStep].
double speechRate(double speed, {TargetPlatform? platform}) {
  final double rate;
  if ((platform ?? defaultTargetPlatform) == TargetPlatform.iOS && speed > 1) {
    rate = normalSpeechRate + iosRateStep * (speed - 1);
  } else {
    rate = normalSpeechRate * speed;
  }
  return rate > 1 ? 1 : rate;
}

/// [SpeechEngine] on flutter_tts, the fallback for segments whose audio file
/// is not rendered yet.
///
/// The plugin is created on first use, but the audio session is only set up
/// on the first [speak]: on iOS it then shares the app's audio session in
/// the playback category, so the device voice goes on with the screen
/// locked, as files do. [canSpeak] only asks the plugin about voices, so
/// opening Listen never interrupts other apps' audio.
///
/// Events count only for the utterance that is playing: after [stop], a late
/// completion or error of the stopped utterance is dropped until the next
/// utterance has started (flutter_tts's start handler).
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
  Future<void>? _session;
  String? _language;
  bool _live = false;

  @override
  Stream<void> get completed => _completed.stream;

  @override
  Stream<Object> get failed => _failed.stream;

  /// The plugin, created with its handlers on first use. Creating it touches
  /// no audio session.
  FlutterTts get _plugin {
    return _tts ??= _create()
      ..setStartHandler(() => _live = true)
      ..setCompletionHandler(() {
        if (_take()) _completed.add(null);
      })
      ..setErrorHandler((message) {
        if (_take()) _failed.add((message as Object?) ?? 'error');
      });
  }

  /// Whether an event belongs to the utterance playing, which it ends.
  bool _take() {
    final live = _live;
    _live = false;
    return live;
  }

  /// Takes the audio session for speaking, once: on iOS, the app's shared
  /// session in the playback category.
  Future<void> _takeSession(FlutterTts tts) => _session ??= () async {
    if (_platform() != TargetPlatform.iOS) return;
    await tts.setSharedInstance(true);
    await tts.setIosAudioCategory(IosTextToSpeechAudioCategory.playback, [
      IosTextToSpeechAudioCategoryOptions.allowBluetooth,
      IosTextToSpeechAudioCategoryOptions.allowBluetoothA2DP,
      IosTextToSpeechAudioCategoryOptions.allowAirPlay,
    ]);
  }();

  @override
  Future<bool> canSpeak(String locale) async {
    final voices = FlutterTtsVoices(tts: _plugin);
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
    final tts = _plugin;
    _live = false;
    await _takeSession(tts);
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
    await tts.setSpeechRate(speechRate(speed, platform: _platform()));
    // flutter_tts answers 1 when the utterance was queued, 0 when not.
    final Object? queued = await tts.speak(text);
    if (queued == 0) throw Exception('The device could not speak');
  }

  @override
  Future<void> stop() async {
    _live = false;
    await _tts?.stop();
  }

  @override
  Future<void> dispose() async {
    await stop();
    await _completed.close();
    await _failed.close();
  }
}
