import 'package:flutter/widgets.dart';
import 'package:lectio/features/listen/listen_segment.dart';
import 'package:lectio/l10n/lectio_localizations.dart';

/// The words of the Listen screen and its lock-screen controls in the UI
/// language, from the app's catalog (`app_listen_*`).
class ListenStrings {
  /// The strings of [_l10n].
  const new(this._l10n);

  /// The strings of the nearest localizations (English without them).
  factory of(BuildContext context) {
    return ListenStrings(LectioLocalizations.of(context));
  }

  /// The strings of [language] (English when the app does not have it).
  factory forLanguage(String language) {
    return ListenStrings(LectioLocalizations.forLanguage(language));
  }

  /// The English strings.
  static final ListenStrings en = ListenStrings(LectioLocalizations.en);

  final LectioLocalizations _l10n;

  String _t(String key, [Map<String, Object> params = const {}]) {
    return _l10n.text('app_listen_$key', params);
  }

  /// The UI language, for example `sw`.
  String get languageCode => _l10n.languageCode;

  /// A date the API publishes no day document for.
  String get emptyDay => _t('emptyDay');

  /// The day could not be fetched and nothing is saved.
  String get loadFailed => _t('loadFailed');

  /// Retries loading the day.
  String get retry => _l10n.text('pwa_offline_retry');

  /// A day without approved notes to narrate.
  String get nothingToPlay => _t('nothingToPlay');

  /// A saved day is shown because the network could not be reached.
  String get offline => _t('offline');

  /// Plays the queue.
  String get play => _t('play');

  /// Pauses the queue.
  String get pause => _t('pause');

  /// Goes to the next segment.
  String get next => _t('next');

  /// Goes to the previous segment, or the start of this one.
  String get previous => _t('previous');

  /// The speed menu.
  String get speed => _t('speed');

  /// Marks a segment read by the device's text-to-speech.
  String get deviceVoice => _t('deviceVoice');

  /// Marks a Kiswahili note played as its English original.
  String get inEnglish => _t('inEnglish');

  /// Says the device has no Kiswahili voice, so notes without a Kiswahili
  /// recording play in English.
  String get noVoice => _t('noVoice');

  /// Heading of the queue list.
  String get queue => _t('queue');

  /// Shown once the last segment has played.
  String get finished => _t('finished');

  /// The name of [kind], as shown under a segment.
  String kindLabel(SegmentKind kind) => switch (kind) {
    SegmentKind.context => _t('kindContext'),
    SegmentKind.translationNote => _t('kindNote'),
  };

  /// Where the segment at [index] sits among [count]: `2 of 5`.
  String position(int index, int count) {
    return _t('position', {'index': index + 1, 'count': count});
  }
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
