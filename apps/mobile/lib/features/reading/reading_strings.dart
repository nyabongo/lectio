import 'package:flutter/widgets.dart';
import 'package:lectio/features/today/today_labels.dart';
import 'package:lectio/l10n/lectio_localizations.dart';

/// The words the Reading screen shows, in the UI language.
///
/// They are the site's `reading` and `day.slot` messages
/// (`apps/web/src/i18n/<locale>/`) where the site has them, and the app's
/// own (`app_reading_*`) otherwise.
class ReadingStrings {
  /// The strings of [_l10n].
  const new(this._l10n);

  /// The strings of the nearest localizations (English without them).
  factory of(BuildContext context) {
    return ReadingStrings(LectioLocalizations.of(context));
  }

  /// The English strings.
  static final ReadingStrings en = ReadingStrings(LectioLocalizations.en);

  final LectioLocalizations _l10n;

  String _t(String key, [Map<String, Object> params = const {}]) {
    return _l10n.text(key, params);
  }

  /// The language, for dates and for marking English-only notes.
  String get languageCode => _l10n.languageCode;

  /// The Context tab.
  String get contextTab => _t('reading_tabs_context');

  /// The Original tab.
  String get originalTab => _t('reading_tabs_original');

  /// The Text link-out, which opens the licensed reading text.
  String get textTab => _t('reading_tabs_text');

  /// What the Text link-out does, for screen readers and the tooltip.
  String textLabel(String ref, String source) {
    return _t('app_reading_textLabel', {'ref': ref, 'source': source});
  }

  /// Shown while the day is loading.
  String get loading => _t('app_reading_loading');

  /// Shown when the day could not be loaded and nothing is saved offline.
  String get loadFailed => _t('app_reading_loadFailed');

  /// Retries loading the day.
  String get retry => _t('pwa_offline_retry');

  /// Shown above notes saved offline when refreshing them failed.
  String get offline => _t('app_reading_offline');

  /// Shown for a day without readings.
  String get noReadings => _t('app_reading_noReadings');

  /// Shown when the day has no reading in [slot].
  String noSuchReading(String slot) {
    return _t('app_reading_noSuchReading', {'slot': slotLabel(slot)});
  }

  /// Shown for a reading whose notes are not approved yet.
  String get pending => _t('reading_pending');

  /// Shown on the Original tab when a passage has no translation notes.
  String get noNotes => _t('reading_noNotes');

  /// Heading of a source list.
  String get sources => _t('reading_sources');

  /// What a screen reader says for a citation of the sources [numbers], as
  /// the site's `reading.cite` label does.
  String cite(List<int> numbers) {
    final n = numbers.join(', ');
    if (numbers.length == 1) return _t('reading_cite', {'n': n});
    return _t('app_reading_citeMany', {'n': n});
  }

  /// The link to an archived copy of a web source.
  String get archived => _t('reading_archived');

  /// "Verse 15", the start of a note card's title.
  String verse(String verse) => _t('reading_note_verse', {'verse': verse});

  /// Label of the original-language words of a note.
  String get originalLabel => _t('reading_note_originalLabel');

  /// Label of the transliteration of a note.
  String get translitLabel => _t('reading_note_translitLabel');

  /// Label of the literal gloss of a note.
  String get glossLabel => _t('reading_note_glossLabel');

  /// The verified badge of approved notes with [count] sources.
  String verified(int count) => _t('reading_verified', {'count': count});

  /// How approved notes were reviewed: `human` or `auto`.
  String method(String method) {
    final key = method == 'auto' ? 'auto' : 'human';
    return _t('reading_method_$key');
  }

  /// Shown instead of the badge for notes that are not approved.
  String get unverified => _t('reading_unverified');

  /// When the notes were last reviewed.
  String lastReviewed(String date) {
    return _t('reading_lastReviewed', {'date': date});
  }

  /// The report-an-issue link of every note.
  String get report => _t('reading_report');

  /// Shown when a link cannot be opened on this device.
  String get linkFailed => _t('app_reading_linkFailed');

  /// The study-aid disclaimer under the notes.
  String get disclaimer => _t('reading_disclaimer');

  /// The badge of notes shown in English because they have no reviewed
  /// translation yet.
  String get englishOnly => _t('reading_englishOnly_badge');

  /// Why the notes are in English.
  String get englishOnlyText => _t('reading_englishOnly_text');

  /// The label of a reading slot: `First reading`, `Psalm`, `Gospel`,
  /// `Reading 3`, `Psalm 2`, `Epistle`; else `Reading`.
  String slotLabel(String slot) => slotLabelIn(_l10n, slot);
}
