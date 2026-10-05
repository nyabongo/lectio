import 'dart:async';

import 'package:lectio/data/models/notes.dart';
import 'package:lectio/features/listen/listen_players.dart';
import 'package:lectio/features/listen/listen_segment.dart';

/// An [AudioFilePlayer] that records calls and plays nothing; tests end
/// files with [complete] and break them with [fail].
class FakeAudioFilePlayer implements AudioFilePlayer {
  final StreamController<void> _completed = StreamController.broadcast(
    sync: true,
  );
  final StreamController<Object> _failed = StreamController.broadcast(
    sync: true,
  );
  final StreamController<Duration> _positions = StreamController.broadcast(
    sync: true,
  );

  /// Every call, in order, for example `load https://…` or `play`.
  final List<String> calls = [];

  /// URLs that fail to load.
  final Set<Uri> broken = {};

  /// The length [load] reports.
  Duration? length = const Duration(seconds: 60);

  /// Completes loads when set; loads finish at once while `null`.
  Completer<void>? loadGate;

  /// Whether [dispose] ran.
  bool disposed = false;

  @override
  Duration position = Duration.zero;

  /// The speed last set.
  double speed = 1;

  @override
  Stream<void> get completed => _completed.stream;

  @override
  Stream<Object> get failed => _failed.stream;

  @override
  Stream<Duration> get positions => _positions.stream;

  /// Ends the current file.
  void complete() => _completed.add(null);

  /// Fails the current file while it plays.
  void fail() => _failed.add(StateError('dropped'));

  /// Moves to [value] and tells listeners.
  void moveTo(Duration value) {
    position = value;
    _positions.add(value);
  }

  @override
  Future<Duration?> load(Uri url, {Duration start = Duration.zero}) async {
    calls.add('load $url');
    await loadGate?.future;
    if (broken.contains(url)) throw Exception('cannot load $url');
    position = start;
    return length;
  }

  @override
  Future<void> play() async => calls.add('play');

  @override
  Future<void> pause() async => calls.add('pause');

  @override
  Future<void> stop() async => calls.add('stop');

  @override
  Future<void> seek(Duration position) async {
    calls.add('seek ${position.inSeconds}');
    this.position = position;
  }

  @override
  Future<void> setSpeed(double speed) async {
    calls.add('speed $speed');
    this.speed = speed;
  }

  @override
  Future<void> dispose() async {
    disposed = true;
    await _completed.close();
    await _failed.close();
    await _positions.close();
  }
}

/// A [SpeechEngine] that records what it is asked to say; tests end
/// utterances with [complete] and break them with [fail].
class FakeSpeechEngine implements SpeechEngine {
  final StreamController<void> _completed = StreamController.broadcast(
    sync: true,
  );
  final StreamController<Object> _failed = StreamController.broadcast(
    sync: true,
  );

  /// Every call, in order, for example `speak en 1.0 …` or `stop`.
  final List<String> calls = [];

  /// Whether [speak] throws.
  bool throws = false;

  /// The languages the device has a voice for.
  Set<String> voices = {'en', 'sw'};

  /// Whether [canSpeak] fails.
  bool voiceCheckThrows = false;

  /// The locales [canSpeak] was asked about, in order.
  final List<String> asked = [];

  /// Whether [dispose] ran.
  bool disposed = false;

  @override
  Stream<void> get completed => _completed.stream;

  @override
  Stream<Object> get failed => _failed.stream;

  /// The current utterance ends.
  void complete() => _completed.add(null);

  /// The device cannot read the current utterance.
  void fail() => _failed.add('synthesis failed');

  @override
  Future<void> speak(
    String text, {
    required String locale,
    required double speed,
  }) async {
    calls.add('speak $locale $speed $text');
    if (throws) throw Exception('no engine');
  }

  @override
  Future<bool> canSpeak(String locale) async {
    asked.add(locale);
    if (voiceCheckThrows) throw Exception('no voices');
    return voices.contains(locale);
  }

  @override
  Future<void> stop() async => calls.add('stop');

  @override
  Future<void> dispose() async {
    disposed = true;
    await _completed.close();
    await _failed.close();
  }
}

/// A segment `S<n>` with audio at `https://audio.test/<n>.mp3`, or read by
/// the device voice when [audio] is false.
ListenSegment testSegment(
  int n, {
  bool audio = true,
  double? seconds,
  String locale = 'en',
  ListenSegment? fallback,
}) {
  return ListenSegment(
    id: 'MT.20.1-16/note/n$n',
    kind: n == 0 ? SegmentKind.context : SegmentKind.translationNote,
    slot: 'gospel',
    passageKey: 'MT.20.1-16',
    ref: 'Mt 20:1-16a',
    locale: locale,
    title: 'Segment $n',
    script: 'Script $n.',
    fallback: fallback,
    audio: audio
        ? Audio(
            url: Uri.parse('https://audio.test/$n.mp3'),
            durationSeconds: seconds,
          )
        : null,
  );
}

/// The URL of [testSegment] `n`.
Uri testUrl(int n) => Uri.parse('https://audio.test/$n.mp3');

/// Lets the queue react to player events.
Future<void> settle() => Future<void>.delayed(Duration.zero);
