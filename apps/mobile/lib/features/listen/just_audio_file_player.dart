import 'package:just_audio/just_audio.dart';
import 'package:lectio/features/listen/listen_players.dart';

/// [AudioFilePlayer] on just_audio.
///
/// The just_audio player is created on first use, so building the Listen
/// queue touches no platform code until something plays.
class JustAudioFilePlayer implements AudioFilePlayer {
  /// Creates the player; [create] builds the just_audio player (default:
  /// `AudioPlayer()`).
  new({AudioPlayer Function()? create}) : _create = create ?? AudioPlayer.new;

  final AudioPlayer Function() _create;
  AudioPlayer? _created;

  AudioPlayer get _player => _created ??= _create();

  @override
  Stream<void> get completed => _player.processingStateStream
      .where((state) => state == ProcessingState.completed)
      .map((_) {});

  @override
  Stream<Object> get failed => _player.errorStream;

  @override
  Stream<Duration> get positions => _player.positionStream;

  @override
  Duration get position => _player.position;

  @override
  Future<Duration?> load(Uri url, {Duration start = Duration.zero}) {
    return _player.setAudioSource(AudioSource.uri(url), initialPosition: start);
  }

  @override
  Future<void> play() async {
    // just_audio's play() completes when playing stops; the queue only
    // waits for it to start.
    _player.play().ignore();
  }

  @override
  Future<void> pause() => _player.pause();

  @override
  Future<void> stop() => _player.stop();

  @override
  Future<void> seek(Duration position) => _player.seek(position);

  @override
  Future<void> setSpeed(double speed) => _player.setSpeed(speed);

  @override
  Future<void> dispose() async {
    await _created?.dispose();
  }
}
