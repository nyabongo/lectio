import 'package:lectio/data/models/day.dart';
import 'package:lectio/data/models/notes.dart';
import 'package:lectio/features/listen/locale.dart';

/// What a [ListenSegment] narrates.
enum SegmentKind {
  /// The historical-context note of a passage.
  context,

  /// One translation note of a passage.
  translationNote,
}

/// One item of the Listen queue: a note narrated by its audio file, or read
/// aloud by the device when the file is not rendered yet.
///
/// The queue follows the API's `masses[].segments` (docs/api.md): for every
/// reading with approved notes, in Mass order and with a passage read twice
/// narrated once, a context segment and then one segment per translation
/// note. Ids are the API's: `<passage key>/context` and
/// `<passage key>/note/<note id>`. Segments carry Lectio's own commentary
/// only, never the reading text.
class ListenSegment {
  /// Creates a segment.
  const new({
    required this.id,
    required this.kind,
    required this.slot,
    required this.passageKey,
    required this.ref,
    required this.locale,
    required this.title,
    required this.script,
    this.audio,
    this.fallback,
  });

  /// `<passage key>/context` or `<passage key>/note/<note id>`.
  final String id;

  /// Context or translation note.
  final SegmentKind kind;

  /// The reading slot the passage sits in (the first, when read twice).
  final String slot;

  /// Canonical passage key.
  final String passageKey;

  /// Display reference of the passage, for example `Mt 20:1-16a`.
  final String ref;

  /// Language of the notes, and of the voice that reads [script].
  final String locale;

  /// Short label: the context title, or the note's anchor and
  /// transliteration.
  final String title;

  /// What the device voice reads when there is no [audio]: plain prose with
  /// no claim markers.
  final String script;

  /// The rendered narration, or `null` to use text-to-speech.
  final Audio? audio;

  /// The same note in English, played instead when this segment has no
  /// file and the device has no voice for [locale]; `null` for English.
  final ListenSegment? fallback;

  /// Whether the device voice reads this segment.
  bool get usesSpeech => audio == null;
}

final RegExp _markers = RegExp(r'\s*(?:\[c\d+\])+');
final RegExp _spaces = RegExp(r'\s+');

/// [text] without `[c1]` claim markers, on one line.
String spokenText(String text) {
  return text.replaceAll(_markers, '').replaceAll(_spaces, ' ').trim();
}

/// [text] ending with a full stop, unless it already ends a sentence.
String _sentence(String text) {
  if (text.isEmpty || RegExp(r'[.!?…:;]$').hasMatch(text)) return text;
  return '$text.';
}

/// Whether [passage] is in English, whose scripts open with English
/// connecting words; other languages read the notes as they are.
bool _english(PassageNotes passage) => passage.locale == 'en';

ListenSegment _contextSegment(
  String slot,
  PassageNotes passage,
  ListenSegment? fallback,
) {
  final context = passage.context;
  final title = spokenText(context.title);
  return ListenSegment(
    id: '${passage.key}/context',
    kind: SegmentKind.context,
    slot: slot,
    passageKey: passage.key,
    ref: passage.ref,
    locale: passage.locale,
    title: title,
    script: [
      if (_english(passage)) 'Context for ${passage.ref}.',
      _sentence(title),
      for (final paragraph in context.paragraphs)
        _sentence(spokenText(paragraph)),
    ].where((part) => part.isNotEmpty).join(' '),
    audio: context.audio,
    fallback: fallback,
  );
}

ListenSegment _noteSegment(
  String slot,
  PassageNotes passage,
  TranslationNote note,
  ListenSegment? fallback,
) {
  final original = note.original;
  final String intro;
  if (_english(passage)) {
    final word = note.anchor.contains(' ') ? 'words' : 'word';
    intro =
        'Translation note on ${passage.ref}, verse ${note.verse}, '
        'the $word “${note.anchor}”. Literally “${original.gloss}”.';
  } else {
    intro = '“${note.anchor}”: ${original.translit}, “${original.gloss}”.';
  }
  return ListenSegment(
    id: '${passage.key}/note/${note.id}',
    kind: SegmentKind.translationNote,
    slot: slot,
    passageKey: passage.key,
    ref: passage.ref,
    locale: passage.locale,
    title: '${note.anchor} · ${original.translit}',
    script: '$intro ${_sentence(spokenText(note.body))}',
    audio: note.audio,
    fallback: fallback,
  );
}

/// The segments of [passage] in [slot]: its context note, then each
/// translation note, each with the segment of the same id in [fallbacks]
/// (the English ones, for a translation).
List<ListenSegment> _passageSegments(
  String slot,
  PassageNotes passage, [
  Map<String, ListenSegment> fallbacks = const {},
]) {
  final context = '${passage.key}/context';
  return [
    _contextSegment(slot, passage, fallbacks[context]),
    for (final note in passage.translationNotes)
      _noteSegment(
        slot,
        passage,
        note,
        fallbacks['${passage.key}/note/${note.id}'],
      ),
  ];
}

/// The Listen queue of [mass]: its readings' approved notes in order, each
/// passage once.
///
/// In the UI [language] `sw`, a passage whose notes [localized] (the same
/// Mass from the `sw/` mirror) has as a reviewed translation is narrated in
/// Kiswahili (`narratedPassage`), each segment keeping its English original
/// as [ListenSegment.fallback] for a device without a Kiswahili voice. Other
/// passages stay in English, with their recordings.
List<ListenSegment> segmentsForMass(
  Mass<DayReading> mass, {
  Mass<DayReading>? localized,
  String language = 'en',
}) {
  final translations = <String, PassageNotes>{};
  for (final reading in localized?.readings ?? const <DayReading>[]) {
    final passage = reading.passage;
    if (passage != null) translations[passage.key] = passage;
  }
  final seen = <String>{};
  final out = <ListenSegment>[];
  for (final reading in mass.readings) {
    final english = reading.passage;
    if (english == null || !seen.add(english.key)) continue;
    final englishSegments = _passageSegments(reading.slot, english);
    final narrated = narratedPassage(
      language: language,
      english: english,
      localized: translations[english.key],
    );
    if (identical(narrated, english)) {
      out.addAll(englishSegments);
    } else {
      out.addAll(
        _passageSegments(reading.slot, narrated, {
          for (final segment in englishSegments) segment.id: segment,
        }),
      );
    }
  }
  return List.unmodifiable(out);
}
