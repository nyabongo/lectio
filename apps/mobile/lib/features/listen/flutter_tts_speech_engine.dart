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

/// How long an utterance may take to start before the engine gives up on it
/// (the web's `SPEECH_START_TIMEOUT`).
const Duration speechStartTimeout = Duration(seconds: 5);

/// Error messages that report an interruption or a cancel, not a failure.
final RegExp _cancelError = RegExp('interrupted|cancel', caseSensitive: false);

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
/// Events are matched to utterances, which flutter_tts does not name:
///
/// - Stopping or replacing an utterance that was queued or speaking leaves
///   it one terminal event (completion, error or cancel) still to come. The
///   first such events before the next start event pay those debts and are
///   dropped, so a late event of a stopped utterance never ends the next one
///   (which would skip a segment that never played). The next start event
///   clears what is still owed.
/// - An error that reports an interruption or a cancel (`interrupted`,
///   `cancel…`) is never a failure, as on the web. One that ends the
///   speaking utterance with nothing owed (iOS interrupts speech for a call,
///   say) reports [stalled], so the queue pauses and keeps its place rather
///   than showing "playing" in silence.
/// - Any other error after [speak] handed the utterance to the device, with
///   no debt outstanding, fails it even before it started: Android can
///   report one without ever starting, and the queue would wait on it.
/// - A start watchdog: an utterance that neither starts nor fails within
///   [startTimeout] is stopped. When no utterance has started yet, the
///   device cannot speak and the utterance fails (the queue skips it);
///   after one has, the stall is temporary and the engine reports
///   [stalled] (the queue pauses and keeps the place), as the web does
///   (L-085).
/// - A start that arrives after an utterance was stopped (by the watchdog,
///   or by [stop] or a new [speak]) before it started, and before the next
///   one is queued, is that utterance's late start: it is not speaking, and
///   it still owes the end its stop brings, so it neither stalls nor leaves
///   the next utterance a debt.
/// - Events that arrive after [dispose] are dropped.
class FlutterTtsSpeechEngine implements SpeechEngine {
  /// Creates the engine; [create] builds the plugin (default:
  /// `FlutterTts()`), [platform] tells which platform runs (default:
  /// [defaultTargetPlatform]) and [startTimeout] is the watchdog's wait.
  new({
    FlutterTts Function()? create,
    TargetPlatform Function()? platform,
    this.startTimeout = speechStartTimeout,
  }) : _create = create ?? FlutterTts.new,
       _platform = platform ?? (() => defaultTargetPlatform);

  /// How long an utterance may take to start before the watchdog stops it.
  final Duration startTimeout;

  final FlutterTts Function() _create;
  final TargetPlatform Function() _platform;
  final StreamController<void> _completed = StreamController.broadcast();
  final StreamController<Object> _failed = StreamController.broadcast();
  final StreamController<void> _stalled = StreamController.broadcast();
  FlutterTts? _tts;
  Future<void>? _session;
  String? _language;

  /// The current utterance has started and not ended.
  bool _live = false;

  /// The current utterance was handed to the device and has not started.
  bool _queued = false;

  /// Terminal events still to come from stopped or replaced utterances.
  int _owed = 0;

  /// Whether the device has started an utterance since the engine was made.
  bool _heard = false;

  /// The last utterance was stopped before it started and none was queued
  /// since: a start now is that utterance's, late.
  bool _lateStartOwed = false;

  Timer? _watchdog;

  @override
  Stream<void> get completed => _completed.stream;

  @override
  Stream<Object> get failed => _failed.stream;

  @override
  Stream<void> get stalled => _stalled.stream;

  /// The plugin, created with its handlers on first use. Creating it touches
  /// no audio session.
  FlutterTts get _plugin {
    return _tts ??= _create()
      ..setStartHandler(() {
        _heard = true;
        if (_lateStartOwed) {
          // The stopped utterance's late start: it is not speaking, and its
          // end is still owed.
          _lateStartOwed = false;
          return;
        }
        _calm();
        _live = true;
        _queued = false;
        _owed = 0;
      })
      ..setCompletionHandler(() => _ended(completed: true))
      ..setCancelHandler(_ended)
      ..setErrorHandler((message) {
        final error = (message as Object?) ?? 'error';
        if (_cancelError.hasMatch('$error')) {
          _ended();
        } else {
          _ended(error: error);
        }
      });
  }

  /// A terminal event: it pays a stopped utterance's debt first, else ends
  /// the current utterance (an [error] also before it started). A cancel
  /// (neither [completed] nor [error]) ends a speaking one as a stall, and
  /// leaves one not started to the watchdog.
  void _ended({bool completed = false, Object? error}) {
    if (_completed.isClosed) return;
    if (_owed > 0) {
      _owed--;
      return;
    }
    if (_live) {
      _live = false;
      _calm();
      if (completed) {
        _completed.add(null);
      } else if (error != null) {
        _failed.add(error);
      } else {
        _stalled.add(null);
      }
    } else if (_queued && error != null) {
      _queued = false;
      _calm();
      _failed.add(error);
    }
  }

  /// Leaves the current utterance, if any, one terminal event to come, and
  /// one not started yet a late start too.
  void _retire() {
    _calm();
    if (_live || _queued) {
      _owed++;
      _lateStartOwed = _queued;
    }
    _live = false;
    _queued = false;
  }

  void _calm() {
    _watchdog?.cancel();
    _watchdog = null;
  }

  /// No start in time: stop the utterance, and fail it when the device has
  /// never spoken, else report a stall.
  void _bark(FlutterTts tts) {
    _watchdog = null;
    if (!_queued) return;
    _retire();
    unawaited(tts.stop());
    if (_failed.isClosed) return;
    if (_heard) {
      _stalled.add(null);
    } else {
      _failed.add('The device voice did not start');
    }
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
    _retire();
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
    // From here an error before the start event is this utterance's,
    // unless a stopped one still owes its end.
    _queued = true;
    _lateStartOwed = false;
    // An overlapping speak may have set a watchdog since this one retired
    // the last utterance.
    _calm();
    _watchdog = Timer(startTimeout, () => _bark(tts));
    // flutter_tts answers 1 when the utterance was queued, 0 when not.
    final Object? queued = await tts.speak(text);
    if (queued == 0) {
      _calm();
      _queued = false;
      throw Exception('The device could not speak');
    }
  }

  @override
  Future<void> stop() async {
    _retire();
    await _tts?.stop();
  }

  @override
  Future<void> dispose() async {
    await stop();
    await _completed.close();
    await _failed.close();
    await _stalled.close();
  }
}
