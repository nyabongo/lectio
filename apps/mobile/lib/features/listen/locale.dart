import 'package:flutter_tts/flutter_tts.dart';
import 'package:lectio/data/models/notes.dart';

/// The language a narration segment is spoken in, with the text-to-speech
/// voices that can speak it, best first (L-114).
enum NarrationLocale {
  /// English: British, then American, then any.
  en(['en-GB', 'en-US', 'en']),

  /// Kiswahili: Kenyan, then Tanzanian, then any.
  sw(['sw-KE', 'sw-TZ', 'sw']);

  new(this.voices);

  /// BCP 47 tags of the voices, in the order they are tried.
  final List<String> voices;

  /// The locale of notes written in [language] (a passage's `locale`):
  /// Kiswahili for `sw`, English for everything else.
  static NarrationLocale of(String language) {
    return language == 'sw' ? NarrationLocale.sw : NarrationLocale.en;
  }
}

/// One item of the Listen queue: what is said, in which language, and the
/// rendered audio when there is some (else device text-to-speech).
class NarrationSegment {
  /// Creates a segment.
  const new({
    required this.id,
    required this.text,
    required this.locale,
    this.audio,
  });

  /// `context`, or the translation note's id.
  final String id;

  /// The words spoken by text-to-speech, without claim markers.
  final String text;

  /// The language of [text] (and of [audio]).
  final NarrationLocale locale;

  /// The rendered narration, or `null` to speak [text] on the device.
  final Audio? audio;

  /// Whether the segment is spoken by the device's text-to-speech.
  bool get usesTextToSpeech => audio == null;
}

final RegExp _claimMarker = RegExp(r'\s*\[c\d+\]');

String _spoken(String text) => text.replaceAll(_claimMarker, '').trim();

/// The notes to narrate in the UI [language]: the Kiswahili ones from the
/// `sw` mirror when [localized] is a reviewed translation (`locale: sw`),
/// else the [english] ones.
///
/// The mirror serves English notes, without audio, for passages that have no
/// reviewed translation; the English document is used instead so its
/// rendered audio still plays.
PassageNotes narratedPassage({
  required String language,
  required PassageNotes english,
  PassageNotes? localized,
}) {
  if (language == 'sw' && localized != null && localized.locale == 'sw') {
    return localized;
  }
  return english;
}

/// The Listen segments of [passage] in its own language: the context note,
/// then each translation note. Kiswahili notes are spoken by a Kiswahili
/// voice, English ones (including the English fallback) by an English one.
List<NarrationSegment> narrationSegments(PassageNotes passage) {
  final locale = NarrationLocale.of(passage.locale);
  final context = passage.context;
  return [
    NarrationSegment(
      id: 'context',
      text: _spoken([context.title, ...context.paragraphs].join('\n\n')),
      locale: locale,
      audio: context.audio,
    ),
    for (final note in passage.translationNotes)
      NarrationSegment(
        id: note.id,
        text: _spoken(note.body),
        locale: locale,
        audio: note.audio,
      ),
  ];
}

/// The text-to-speech engine's voices, behind an interface so tests use a
/// fake.
abstract interface class TtsVoices {
  /// Whether the device can speak [language] (a BCP 47 tag).
  Future<bool> isLanguageAvailable(String language);

  /// Speaks from now on in [language].
  Future<void> setLanguage(String language);
}

/// [TtsVoices] on `flutter_tts`.
class FlutterTtsVoices implements TtsVoices {
  /// Creates the voices of [tts] (default: a new `FlutterTts`).
  new({FlutterTts? tts}) : _tts = tts ?? FlutterTts();

  final FlutterTts _tts;

  @override
  Future<bool> isLanguageAvailable(String language) async {
    final Object? available = await _tts.isLanguageAvailable(language);
    return available == true || available == 1;
  }

  @override
  Future<void> setLanguage(String language) async {
    await _tts.setLanguage(language);
  }
}

/// Sets [tts] to the first available voice for [locale]; when the device
/// has none (no Kiswahili voice installed), to an English one, so the queue
/// still plays. Returns the tag set, or `null` when no voice is available.
Future<String?> useVoiceFor(NarrationLocale locale, TtsVoices tts) async {
  final tags = {...locale.voices, ...NarrationLocale.en.voices};
  for (final tag in tags) {
    if (await tts.isLanguageAvailable(tag)) {
      await tts.setLanguage(tag);
      return tag;
    }
  }
  return null;
}
