import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:lectio/features/listen/listen_players.dart';
import 'package:lectio/features/listen/listen_segment.dart';

/// Where the Listen queue is.
enum ListenStatus {
  /// Nothing started yet, or stopped.
  idle,

  /// Loading the current segment's audio file.
  loading,

  /// Playing the current segment.
  playing,

  /// Paused in the current segment.
  paused,

  /// Played to the end of the last segment.
  completed,
}

/// How far back "previous" restarts the current segment instead of going to
/// the one before.
const Duration restartThreshold = Duration(seconds: 3);

/// The Listen queue: plays a Mass's segments in order, each from its audio
/// file through [AudioFilePlayer], or with the device voice through
/// [SpeechEngine] when the file is missing or fails to load or play.
///
/// The queue outlives the Listen screen, so narration goes on in the
/// background and on the lock screen (`ListenAudioHandler`), and reopening
/// the same Mass [load]s it without losing the place: playing resumes where
/// it was paused. Audio files resume at their position; a segment read by
/// the device voice starts again from its beginning.
class ListenQueue extends ChangeNotifier {
  /// Creates a queue playing files on `player` and speaking through
  /// `speech` at `speed`. `beforeFirstPlay` runs once, before the first
  /// segment starts (the app starts background audio there); when it fails,
  /// playing goes on in the foreground.
  new({
    required this._player,
    required this._speech,
    this._beforeFirstPlay,
    this._speed = 1,
  });

  final AudioFilePlayer _player;
  final SpeechEngine _speech;
  final Future<void> Function(ListenQueue queue)? _beforeFirstPlay;
  final List<StreamSubscription<Object?>> _subscriptions = [];
  Future<void>? _prepared;

  String? _queueId;
  List<ListenSegment> _segments = const [];
  int _index = 0;
  ListenStatus _status = ListenStatus.idle;
  double _speed;
  bool _speaking = false;
  bool _fallingBack = false;
  final Map<String, Future<bool>> _voices = {};
  bool _fileLoaded = false;
  Duration? _duration;

  /// Bumped whenever what plays changes, so late results of an older start
  /// are ignored.
  int _generation = 0;

  /// The id of the loaded queue, for example `2026-09-20/day`, or `null`.
  String? get queueId => _queueId;

  /// The loaded segments, in play order.
  List<ListenSegment> get segments => _segments;

  /// The position of [current] in [segments].
  int get index => _index;

  /// Where the queue is.
  ListenStatus get status => _status;

  /// The playing speed (`1` is normal).
  double get speed => _speed;

  /// The current segment, or `null` when the queue is empty.
  ListenSegment? get current => _segments.isEmpty ? null : _segments[_index];

  /// Whether the device voice reads the current segment (its file is
  /// missing or failed).
  bool get speaking => _speaking;

  /// Whether sound is on its way: playing, or loading to play.
  bool get active =>
      _status == ListenStatus.playing || _status == ListenStatus.loading;

  /// Whether the current segment plays as its English
  /// [ListenSegment.fallback], because the device has no voice for its
  /// language.
  bool get fallingBack => _fallingBack;

  /// Whether the device can read [locale] (`en`, `sw`) aloud. Asked once
  /// per locale; a device that cannot say counts as able.
  Future<bool> canSpeak(String locale) {
    return _voices[locale] ??= _speech.canSpeak(locale).catchError((
      Object error,
    ) {
      debugPrint('Listen: no answer about $locale voices ($error)');
      return true;
    });
  }

  /// Length of the current segment's file, when known.
  Duration? get duration => _speaking ? null : _duration;

  /// The position in the current segment's file (zero for the device voice).
  Duration get position => _fileLoaded ? _player.position : Duration.zero;

  /// The position in the current segment's file, as it changes.
  Stream<Duration> get positions => _player.positions;

  /// Whether [segments] is the queue [id] already loaded, segment for
  /// segment.
  bool holds(String id, List<ListenSegment> segments) {
    if (id != _queueId || segments.length != _segments.length) return false;
    for (var i = 0; i < segments.length; i++) {
      if (segments[i].id != _segments[i].id) return false;
    }
    return true;
  }

  /// Loads [segments] as the queue [id], ready to play from the first.
  ///
  /// When the queue already [holds] them, nothing stops and the place is
  /// kept (the segments are refreshed, for example with newly rendered
  /// audio, from the next start). Otherwise what was playing stops.
  Future<void> load(String id, List<ListenSegment> segments) async {
    if (holds(id, segments)) {
      _segments = List.unmodifiable(segments);
      notifyListeners();
      return;
    }
    _generation++;
    final halted = _halt();
    _queueId = id;
    _segments = List.unmodifiable(segments);
    _index = 0;
    _status = ListenStatus.idle;
    _duration = null;
    notifyListeners();
    await halted;
  }

  /// Plays: resumes when paused, starts again after the end, or starts the
  /// current segment.
  Future<void> play() async {
    if (_segments.isEmpty) return;
    switch (_status) {
      case ListenStatus.playing || ListenStatus.loading:
        return;
      case ListenStatus.paused:
        await _resume();
      case ListenStatus.completed:
        await _start(0);
      case ListenStatus.idle:
        await _start(_index);
    }
  }

  /// Pauses the current segment.
  Future<void> pause() async {
    if (!active) return;
    _status = ListenStatus.paused;
    notifyListeners();
    if (_speaking) {
      await _speech.stop();
    } else if (_fileLoaded) {
      await _player.pause();
    }
  }

  /// Pauses when [active], else plays.
  Future<void> toggle() => active ? pause() : play();

  /// Plays the next segment; nothing at the last one.
  Future<void> next() async {
    if (_index + 1 < _segments.length) await _start(_index + 1);
  }

  /// Plays the segment before, or restarts the current file when it is past
  /// [restartThreshold] (or is the first segment).
  Future<void> previous() async {
    if (_segments.isEmpty) return;
    final restart = _fileLoaded && position > restartThreshold;
    await _start(restart || _index == 0 ? _index : _index - 1);
  }

  /// Plays the segment at [index] of [segments].
  Future<void> skipTo(int index) async {
    if (index < 0 || index >= _segments.length) return;
    await _start(index);
  }

  /// Moves to [position] in the current segment's file; nothing for the
  /// device voice.
  Future<void> seek(Duration position) async {
    if (_fileLoaded) await _player.seek(position);
    notifyListeners();
  }

  /// Plays at [speed] from now on: at once for audio files, from the next
  /// segment for the device voice (an utterance cannot change speed).
  Future<void> setSpeed(double speed) async {
    if (speed == _speed) return;
    _speed = speed;
    notifyListeners();
    if (_fileLoaded) await _player.setSpeed(speed);
  }

  /// Stops playing and goes back to the start of the current segment.
  Future<void> stop() async {
    _generation++;
    final halted = _halt();
    _status = ListenStatus.idle;
    notifyListeners();
    await halted;
  }

  @override
  void dispose() {
    _generation++;
    for (final subscription in _subscriptions) {
      unawaited(subscription.cancel());
    }
    unawaited(_player.dispose());
    unawaited(_speech.dispose());
    super.dispose();
  }

  /// Runs [_beforeFirstPlay] once and starts listening to the players.
  Future<void> _prepare() => _prepared ??= _runPrepare();

  Future<void> _runPrepare() async {
    _subscriptions.addAll([
      _player.completed.listen((_) => _fileCompleted()),
      _player.failed.listen((_) => _fileFailed()),
      _speech.completed.listen((_) => _speechEnded()),
      _speech.failed.listen((_) => _speechEnded()),
    ]);
    try {
      await _beforeFirstPlay?.call(this);
    } on Object catch (error) {
      debugPrint('Listen: background audio is off ($error)');
    }
  }

  /// Stops whatever is sounding. The queue forgets it at once, before the
  /// players confirm.
  Future<void> _halt() async {
    final speaking = _speaking;
    final fileLoaded = _fileLoaded;
    _speaking = false;
    _fileLoaded = false;
    _fallingBack = false;
    if (speaking) await _speech.stop();
    if (fileLoaded) await _player.stop();
  }

  Future<void> _start(int index) async {
    final generation = ++_generation;
    final halted = _halt();
    _index = index;
    _status = ListenStatus.loading;
    final segment = _segments[index];
    _duration = segment.audio?.duration;
    notifyListeners();
    await halted;
    await _prepare();
    if (generation != _generation) return;
    await _play(generation, segment);
  }

  /// Plays [segment]'s file, or else reads it aloud.
  Future<void> _play(int generation, ListenSegment segment) async {
    _duration = segment.audio?.duration;
    final audio = segment.audio;
    if (audio != null && await _loadFile(generation, audio.url)) return;
    if (generation != _generation) return;
    await _voice(generation, segment);
  }

  /// Reads [segment] aloud, or plays its English fallback when the device
  /// has no voice for its language.
  Future<void> _voice(int generation, ListenSegment segment) async {
    final fallback = segment.fallback;
    if (fallback != null && !await canSpeak(segment.locale)) {
      if (generation != _generation) return;
      _fallingBack = true;
      await _play(generation, fallback);
      return;
    }
    await _speak(generation, segment);
  }

  /// Loads and plays [url]; `false` when it could not be loaded.
  Future<bool> _loadFile(int generation, Uri url) async {
    try {
      final length = await _player.load(url);
      if (generation != _generation) return true;
      _fileLoaded = true;
      _duration = length ?? _duration;
      await _player.setSpeed(_speed);
    } on Exception catch (error) {
      debugPrint('Listen: $url failed ($error); the device voice reads it');
      return false;
    }
    if (_status != ListenStatus.loading) {
      // Paused while loading: play() resumes from here.
      notifyListeners();
      return true;
    }
    _status = ListenStatus.playing;
    notifyListeners();
    await _player.play();
    return true;
  }

  Future<void> _speak(int generation, ListenSegment segment) async {
    if (_fileLoaded) await _player.stop();
    _fileLoaded = false;
    _speaking = true;
    if (_status != ListenStatus.loading) {
      // Paused while loading: play() speaks the segment.
      notifyListeners();
      return;
    }
    _status = ListenStatus.playing;
    notifyListeners();
    try {
      await _speech.speak(
        segment.script,
        locale: segment.locale,
        speed: _speed,
      );
    } on Exception catch (error) {
      debugPrint('Listen: the device voice failed ($error)');
      if (generation == _generation) await _advance();
    }
  }

  Future<void> _resume() async {
    if (_speaking || !_fileLoaded) {
      await _start(_index);
      return;
    }
    _status = ListenStatus.playing;
    notifyListeners();
    await _player.play();
  }

  /// Moves on after the current segment ends.
  Future<void> _advance() async {
    if (_index + 1 < _segments.length) {
      await _start(_index + 1);
      return;
    }
    _generation++;
    final halted = _halt();
    _status = ListenStatus.completed;
    notifyListeners();
    await halted;
  }

  void _fileCompleted() {
    if (_fileLoaded && _status == ListenStatus.playing) unawaited(_advance());
  }

  /// A file that loaded failed while playing: the device voice reads the
  /// segment instead.
  void _fileFailed() {
    if (!_fileLoaded || !active) return;
    final generation = ++_generation;
    _status = ListenStatus.loading;
    final current = _segments[_index];
    final fallback = current.fallback;
    unawaited(
      _fallingBack && fallback != null
          ? _speak(generation, fallback)
          : _voice(generation, current),
    );
  }

  /// The device voice finished (or could not read) the current segment.
  void _speechEnded() {
    if (_speaking && _status == ListenStatus.playing) unawaited(_advance());
  }
}
