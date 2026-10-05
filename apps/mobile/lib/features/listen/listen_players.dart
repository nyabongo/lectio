/// The two ways the Listen queue makes sound, behind interfaces so the queue
/// logic is tested with fakes: an [AudioFilePlayer] for rendered narration
/// and a [SpeechEngine] for device text-to-speech when a segment has no
/// audio file yet.
library;

/// Plays one audio file at a time (just_audio in the app).
abstract interface class AudioFilePlayer {
  /// Fires when the loaded file has played to its end.
  Stream<void> get completed;

  /// Fires when playback fails after the file loaded, for example when the
  /// connection drops mid-stream.
  Stream<Object> get failed;

  /// The playing position, as it changes.
  Stream<Duration> get positions;

  /// The current position in the loaded file.
  Duration get position;

  /// Loads [url], ready to play from [start]; completes with the file's
  /// length when known, or fails when the file cannot be loaded.
  Future<Duration?> load(Uri url, {Duration start = Duration.zero});

  /// Starts or resumes playing the loaded file. Completes once playing has
  /// started, not when it ends.
  Future<void> play();

  /// Pauses, keeping the position.
  Future<void> pause();

  /// Stops and unloads the file.
  Future<void> stop();

  /// Moves to [position] in the loaded file.
  Future<void> seek(Duration position);

  /// Plays at [speed] (`1` is normal).
  Future<void> setSpeed(double speed);

  /// Releases the player.
  Future<void> dispose();
}

/// Reads text aloud with the device's voice (flutter_tts in the app).
abstract interface class SpeechEngine {
  /// Fires when an utterance started by [speak] has been read to its end.
  /// An utterance interrupted by [stop] does not fire it.
  Stream<void> get completed;

  /// Fires when the device cannot read an utterance.
  Stream<Object> get failed;

  /// Fires when an utterance did not start in time although the device has
  /// spoken before: a temporary stall. The utterance is stopped; the queue
  /// pauses where it is.
  Stream<void> get stalled;

  /// Reads [text] in [locale] at [speed] (`1` is normal), replacing any
  /// utterance in progress. Completes once speaking has started.
  Future<void> speak(
    String text, {
    required String locale,
    required double speed,
  });

  /// Whether the device has a voice for [locale] (`en`, `sw`).
  Future<bool> canSpeak(String locale);

  /// Stops speaking.
  Future<void> stop();

  /// Releases the engine.
  Future<void> dispose();
}
