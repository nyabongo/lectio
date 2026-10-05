import 'package:lectio/data/models/day.dart';
import 'package:lectio/data/models/notes.dart';

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

ListenSegment _contextSegment(String slot, PassageNotes passage) {
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
      'Context for ${passage.ref}.',
      _sentence(title),
      for (final paragraph in context.paragraphs)
        _sentence(spokenText(paragraph)),
    ].where((part) => part.isNotEmpty).join(' '),
    audio: context.audio,
  );
}

ListenSegment _noteSegment(
  String slot,
  PassageNotes passage,
  TranslationNote note,
) {
  final original = note.original;
  final word = note.anchor.contains(' ') ? 'words' : 'word';
  final intro =
      'Translation note on ${passage.ref}, verse ${note.verse}, '
      'the $word “${note.anchor}”.';
  return ListenSegment(
    id: '${passage.key}/note/${note.id}',
    kind: SegmentKind.translationNote,
    slot: slot,
    passageKey: passage.key,
    ref: passage.ref,
    locale: passage.locale,
    title: '${note.anchor} · ${original.translit}',
    script: [
      intro,
      'Literally “${original.gloss}”.',
      _sentence(spokenText(note.body)),
    ].join(' '),
    audio: note.audio,
  );
}

/// The Listen queue of [mass]: its readings' approved notes in order, each
/// passage once.
List<ListenSegment> segmentsForMass(Mass<DayReading> mass) {
  final seen = <String>{};
  final out = <ListenSegment>[];
  for (final reading in mass.readings) {
    final passage = reading.passage;
    if (passage == null || !seen.add(passage.key)) continue;
    out
      ..add(_contextSegment(reading.slot, passage))
      ..addAll([
        for (final note in passage.translationNotes)
          _noteSegment(reading.slot, passage, note),
      ]);
  }
  return List.unmodifiable(out);
}
