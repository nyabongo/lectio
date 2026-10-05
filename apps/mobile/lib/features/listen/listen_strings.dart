import 'package:lectio/features/listen/listen_segment.dart';

/// The English strings of the Listen screen and its lock-screen controls.
/// L-114 moves them to the l10n catalog.
abstract final class ListenStrings {
  /// Shown when the day could not be fetched and nothing is saved.
  static const String loadFailed =
      'The day could not be loaded. Check your connection and try again.';

  /// Retries loading the day.
  static const String retry = 'Try again';

  /// A date the API publishes no day document for.
  static const String emptyDay = 'There is no calendar day for this date yet.';

  /// A day without approved notes to narrate.
  static const String nothingToPlay =
      'There are no notes to listen to for this day yet. Notes are narrated '
      'once they have been checked and approved.';

  /// A saved day is shown because the network could not be reached.
  static const String offline =
      'Offline: notes without a saved recording are read by the device voice.';

  /// Plays the queue.
  static const String play = 'Play';

  /// Pauses the queue.
  static const String pause = 'Pause';

  /// Goes to the next segment.
  static const String next = 'Next note';

  /// Goes to the previous segment, or the start of this one.
  static const String previous = 'Previous note';

  /// The speed menu.
  static const String speed = 'Playback speed';

  /// Marks a segment read by the device's text-to-speech.
  static const String deviceVoice = 'Device voice';

  /// Heading of the queue list.
  static const String queue = 'Queue';

  /// Shown once the last segment has played.
  static const String finished = 'Finished. Play to start again.';

  /// The kind of [kind], as shown under a segment.
  static String kindLabel(SegmentKind kind) => switch (kind) {
    SegmentKind.context => 'Context',
    SegmentKind.translationNote => 'Translation note',
  };

  /// Where the current segment sits: `2 of 5`.
  static String position(int index, int count) => '${index + 1} of $count';
}

/// [duration] as `m:ss`, or `h:mm:ss` from an hour.
String clockLabel(Duration duration) {
  String two(int value) => value.toString().padLeft(2, '0');
  final seconds = duration.inSeconds;
  final hours = seconds ~/ 3600;
  final minutes = (seconds ~/ 60) % 60;
  final rest = two(seconds % 60);
  if (hours > 0) return '$hours:${two(minutes)}:$rest';
  return '$minutes:$rest';
}
