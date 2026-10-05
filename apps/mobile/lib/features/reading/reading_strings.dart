/// The words the Reading screen shows, in English.
///
/// They mirror the site's `reading` and `day.slot` messages
/// (`apps/web/src/i18n/en/`). L-114 moves them to the app's localisations.
class ReadingStrings {
  /// Creates the English strings.
  const new();

  /// The English strings.
  static const ReadingStrings en = ReadingStrings();

  /// The Context tab.
  String get contextTab => 'Context';

  /// The Original tab.
  String get originalTab => 'Original';

  /// The Text link-out, which opens the licensed reading text.
  String get textTab => 'Text';

  /// What the Text link-out does, for screen readers and the tooltip.
  String textLabel(String ref, String source) {
    return 'Read the text of $ref at $source (opens outside the app)';
  }

  /// Shown while the day is loading.
  String get loading => 'Loading the readings…';

  /// Shown when the day could not be loaded and nothing is saved offline.
  String get loadFailed =>
      'The readings could not be loaded. Check your connection and try again.';

  /// Retries loading the day.
  String get retry => 'Try again';

  /// Shown above notes saved offline when refreshing them failed.
  String get offline => 'Offline: showing the notes saved on this device.';

  /// Shown for a day without readings.
  String get noReadings => 'There are no readings for this day yet.';

  /// Shown when the day has no reading in [slot].
  String noSuchReading(String slot) => 'This day has no ${slotLabel(slot)}.';

  /// Shown for a reading whose notes are not approved yet.
  String get pending =>
      'Notes for this reading are in preparation. They appear here once they '
      'have been checked against their sources and approved.';

  /// Shown on the Original tab when a passage has no translation notes.
  String get noNotes =>
      'There are no original-language notes for this reading yet.';

  /// Heading of a source list.
  String get sources => 'Sources';

  /// What a screen reader says for a citation of the sources [numbers], as
  /// the site's `reading.cite` label does.
  String cite(List<int> numbers) {
    if (numbers.length == 1) return 'Source ${numbers.single}';
    return 'Sources ${numbers.join(', ')}';
  }

  /// The link to an archived copy of a web source.
  String get archived => 'Archived copy';

  /// "Verse 15", the start of a note card's title.
  String verse(String verse) => 'Verse $verse';

  /// Label of the original-language words of a note.
  String get originalLabel => 'Original text';

  /// Label of the transliteration of a note.
  String get translitLabel => 'Transliteration';

  /// Label of the literal gloss of a note.
  String get glossLabel => 'Literally';

  /// The verified badge of approved notes with [count] sources.
  String verified(int count) {
    if (count == 1) return 'Verified · 1 source';
    return 'Verified · $count sources';
  }

  /// How approved notes were reviewed: `human` or `auto`.
  String method(String method) {
    if (method == 'auto') {
      return 'Approved after automatic checks and two independent AI '
          'verifiers.';
    }
    return 'Approved by a human reviewer after automatic checks.';
  }

  /// Shown instead of the badge for notes that are not approved.
  String get unverified => 'Not yet verified';

  /// When the notes were last reviewed.
  String lastReviewed(String date) => 'Last reviewed $date';

  /// The report-an-issue link of every note.
  String get report => 'Report an issue';

  /// Shown when a link cannot be opened on this device.
  String get linkFailed => 'The link could not be opened.';

  /// The study-aid disclaimer under the notes.
  String get disclaimer =>
      'A study aid, not Church teaching. Every claim cites its sources: check '
      'them for yourself.';

  /// The label of a reading slot: `First reading`, `Psalm`, `Gospel`,
  /// `Reading 3`, `Psalm 2`, `Epistle`; else `Reading`.
  String slotLabel(String slot) {
    final numbered = RegExp(r'^(reading|psalm)-(\d)$').firstMatch(slot);
    if (numbered != null) {
      final n = numbered.group(2);
      return numbered.group(1) == 'psalm' ? 'Psalm $n' : 'Reading $n';
    }
    return switch (slot) {
      'first-reading' => 'First reading',
      'psalm' => 'Psalm',
      'second-reading' => 'Second reading',
      'gospel' => 'Gospel',
      'epistle' => 'Epistle',
      _ => 'Reading',
    };
  }
}
