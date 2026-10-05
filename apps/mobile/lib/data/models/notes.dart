import 'package:lectio/data/json.dart';

/// A rendered narration file (`audio` in API v1).
///
/// The API sends `null` until the narration pipeline renders audio; callers
/// then fall back to device text-to-speech.
class Audio {
  /// Creates an audio reference.
  const new({required this.url, this.durationSeconds});

  /// Reads an `audio` object.
  factory fromJson(Object? json) {
    final object = asJsonObject(json, 'audio');
    return Audio(
      url: object.uri('url'),
      durationSeconds: object.optionalNumber('durationSeconds'),
    );
  }

  /// Where the audio file is.
  final Uri url;

  /// Length in seconds, when the API gives it.
  ///
  /// The field may be absent as well as null (docs/api.md), so both read as
  /// `null` here.
  final double? durationSeconds;

  /// [durationSeconds] as a [Duration], or `null` when unknown.
  Duration? get duration {
    final seconds = durationSeconds;
    if (seconds == null) return null;
    return Duration(milliseconds: (seconds * 1000).round());
  }
}

Audio? _audio(JsonObject object) {
  final audio = object.optionalObject('audio');
  return audio == null ? null : Audio.fromJson(audio);
}

/// The historical-context note of a passage.
class ContextNote {
  /// Creates a context note.
  const new({required this.title, required this.paragraphs, this.audio});

  /// Reads a `context` object.
  factory fromJson(Object? json) {
    final object = asJsonObject(json, 'context');
    return ContextNote(
      title: object.string('title'),
      paragraphs: object.strings('paragraphs'),
      audio: _audio(object),
    );
  }

  /// The note's title.
  final String title;

  /// Paragraphs, with `[c1]` claim markers kept in place.
  final List<String> paragraphs;

  /// The narration, or `null` to use text-to-speech.
  final Audio? audio;
}

/// The original-language words a translation note is about.
class OriginalText {
  /// Creates an original-language phrase.
  const new({
    required this.text,
    required this.lang,
    required this.translit,
    required this.gloss,
  });

  /// Reads an `original` object.
  factory fromJson(Object? json) {
    final object = asJsonObject(json, 'original');
    return OriginalText(
      text: object.string('text'),
      lang: object.string('lang'),
      translit: object.string('translit'),
      gloss: object.string('gloss'),
    );
  }

  /// The words in the original script.
  final String text;

  /// Language code: `grc`, `hbo`, `arc` or `lat` (open list).
  final String lang;

  /// Transliteration in Latin letters.
  final String translit;

  /// A literal gloss.
  final String gloss;
}

/// A "lost in translation" note on one verse.
class TranslationNote {
  /// Creates a translation note.
  const new({
    required this.id,
    required this.verse,
    required this.anchor,
    required this.original,
    required this.summary,
    required this.body,
    this.audio,
  });

  /// Reads a `translationNotes` item.
  factory fromJson(Object? json) {
    final object = asJsonObject(json, 'translationNotes');
    return TranslationNote(
      id: object.string('id'),
      verse: object.string('verse'),
      anchor: object.string('anchor'),
      original: OriginalText.fromJson(object.object('original')),
      summary: object.string('summary'),
      body: object.string('body'),
      audio: _audio(object),
    );
  }

  /// Stable id within the passage.
  final String id;

  /// `chapter:verse`, for example `20:15`.
  final String verse;

  /// The English word or phrase the note hangs on.
  final String anchor;

  /// What the original says.
  final OriginalText original;

  /// One-line summary.
  final String summary;

  /// The note, with `[c1]` claim markers kept in place.
  final String body;

  /// The narration, or `null` to use text-to-speech.
  final Audio? audio;
}

/// A factual claim made by the notes, with its sources.
class Claim {
  /// Creates a claim.
  const new({
    required this.id,
    required this.text,
    required this.sourceIds,
    required this.sensitive,
  });

  /// Reads a `claims` item.
  factory fromJson(Object? json) {
    final object = asJsonObject(json, 'claims');
    return Claim(
      id: object.string('id'),
      text: object.string('text'),
      sourceIds: object.strings('sourceIds'),
      sensitive: object.boolean('sensitive'),
    );
  }

  /// The marker id, for example `c1`.
  final String id;

  /// The claim in plain words.
  final String text;

  /// Ids of the sources that support it.
  final List<String> sourceIds;

  /// Whether the claim is doctrinally or historically sensitive.
  final bool sensitive;
}

/// A source cited by claims.
class Source {
  /// Creates a source.
  const new({
    required this.id,
    required this.type,
    required this.citation,
    this.url,
    this.archivedUrl,
    this.ref,
    this.excerpt,
    this.excerptLang,
    this.retrievedAt,
  });

  /// Reads a `sources` item.
  factory fromJson(Object? json) {
    final object = asJsonObject(json, 'sources');
    return Source(
      id: object.string('id'),
      type: object.string('type'),
      citation: object.string('citation'),
      url: object.optionalUri('url'),
      archivedUrl: object.optionalUri('archivedUrl'),
      ref: object.optionalString('ref'),
      excerpt: object.optionalString('excerpt'),
      excerptLang: object.optionalString('excerptLang'),
      retrievedAt: object.optionalDateTime('retrievedAt'),
    );
  }

  /// Stable id within the passage.
  final String id;

  /// `scripture`, `web` or `print` (open list).
  final String type;

  /// Human-readable citation.
  final String citation;

  /// Web address, for web sources.
  final Uri? url;

  /// Archived copy of [url].
  final Uri? archivedUrl;

  /// Scripture reference, for scripture sources.
  final String? ref;

  /// A short original-language excerpt.
  final String? excerpt;

  /// Language of [excerpt].
  final String? excerptLang;

  /// When a web source was retrieved.
  final DateTime? retrievedAt;
}

/// What the reader is told about the review of the notes.
class Review {
  /// Creates a review block.
  const new({required this.status, required this.method, this.lastReviewedAt});

  /// Reads a `review` object.
  factory fromJson(Object? json) {
    final object = asJsonObject(json, 'review');
    return Review(
      status: object.string('status'),
      method: object.string('method'),
      lastReviewedAt: object.optionalDateTime('lastReviewedAt'),
    );
  }

  /// Always `approved` in the published API.
  final String status;

  /// `human` or `auto`.
  final String method;

  /// When the notes were last reviewed, or `null` if unknown.
  final DateTime? lastReviewedAt;
}

/// The approved notes for one passage. Never the reading text.
class PassageNotes {
  /// Creates passage notes.
  const new({
    required this.key,
    required this.ref,
    required this.locale,
    required this.summary,
    required this.context,
    required this.translationNotes,
    required this.claims,
    required this.sources,
    required this.review,
  });

  /// Reads a `passage` object.
  factory fromJson(Object? json) {
    final object = asJsonObject(json, 'passage');
    return PassageNotes(
      key: object.string('key'),
      ref: object.string('ref'),
      locale: object.string('locale'),
      summary: object.string('summary'),
      context: ContextNote.fromJson(object.object('context')),
      translationNotes: object.list(
        'translationNotes',
        TranslationNote.fromJson,
      ),
      claims: object.list('claims', Claim.fromJson),
      sources: object.list('sources', Source.fromJson),
      review: Review.fromJson(object.object('review')),
    );
  }

  /// Canonical passage key, for example `MT.20.1-16`.
  final String key;

  /// Display reference, for example `Mt 20:1-16a`.
  final String ref;

  /// Locale of the notes.
  final String locale;

  /// One-line summary.
  final String summary;

  /// The historical-context note.
  final ContextNote context;

  /// Translation notes, in verse order.
  final List<TranslationNote> translationNotes;

  /// Claims that `[c1]` markers point to.
  final List<Claim> claims;

  /// Sources the claims cite.
  final List<Source> sources;

  /// The review block.
  final Review review;

  /// The claim with marker [id], or `null`.
  Claim? claim(String id) {
    for (final item in claims) {
      if (item.id == id) return item;
    }
    return null;
  }

  /// The source with [id], or `null`.
  Source? source(String id) {
    for (final item in sources) {
      if (item.id == id) return item;
    }
    return null;
  }
}
