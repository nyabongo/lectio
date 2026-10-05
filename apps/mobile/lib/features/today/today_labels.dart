import 'package:flutter/widgets.dart';
import 'package:intl/intl.dart';
import 'package:lectio/l10n/lectio_localizations.dart';

/// The strings of the Today screen in the UI language, worded as on the
/// site (`apps/web/src/i18n/<locale>/day.json`) where the site has them and
/// from the app's catalog (`app_today_*`) otherwise.
class TodayStrings {
  /// The strings of [_l10n].
  const new(this._l10n);

  /// The strings of the nearest localizations (English without them).
  factory of(BuildContext context) {
    return TodayStrings(LectioLocalizations.of(context));
  }

  /// The English strings.
  static final TodayStrings en = TodayStrings(LectioLocalizations.en);

  final LectioLocalizations _l10n;

  String _t(String key, [Map<String, Object> params = const {}]) {
    return _l10n.text(key, params);
  }

  /// The language, for dates.
  String get languageCode => _l10n.languageCode;

  /// The eyebrow above the date when it is the device's date.
  String get todayHeading => _t('day_todayHeading');

  /// Goes back to the device's date from another day.
  String get backToToday => _t('app_today_backToToday');

  /// Tooltip of the date button, which opens the date picker.
  String get chooseDate => _t('app_today_chooseDate');

  /// The Listen button.
  String get listen => _t('day_listen');

  /// The button that opens a reading's notes.
  String get notes => _t('calendar_passage_notes');

  /// The link-out to the licensed text of a reading.
  String get text => '${_t('day_linkout_text')} ↗';

  /// A reading without approved notes.
  String get notesInPreparation => _t('day_notesInPreparation');

  /// A day whose readings all lack approved notes.
  String get notesMissing => _t('app_today_notesMissing');

  /// A day the lectionary has no readings for.
  String get lectionaryMissing => _t('day_lectionaryMissing');

  /// Holy Saturday, the only day without any Mass (`noMass`). A second such
  /// day needs its own copy.
  String get holySaturdayNoMass => _t('day_holySaturdayNoMass');

  /// A date the API publishes no day document for.
  String get emptyDay => _t('app_today_emptyDay');

  /// The day could not be fetched and nothing is saved on the device.
  String get loadFailed => _t('app_today_loadFailed');

  /// Retries loading the day.
  String get retry => _t('pwa_offline_retry');

  /// A saved day is shown because the network could not be reached.
  String get offline => _t('app_today_offline');

  /// A saved day is shown because the server answered with an error.
  String get refreshFailed => _t('app_today_refreshFailed');

  /// The link-out could not be opened.
  String get linkFailed => _t('app_today_linkFailed');

  /// The season name, for example `Ordinary Time`.
  String seasonName(String season) {
    final key = switch (season) {
      'advent' => 'advent',
      'christmas' => 'christmas',
      'lent' => 'lent',
      'paschal-triduum' => 'paschalTriduum',
      'easter' => 'easter',
      _ => 'ordinaryTime',
    };
    return _t('day_season_$key');
  }

  /// The season with its week, `Ordinary Time · Week 25`; week 0 (the days
  /// before a season's first Sunday) is left out.
  String seasonLabel(String season, int week) {
    final name = seasonName(season);
    if (week <= 0) return name;
    return _t('day_seasonWeek', {'season': name, 'week': week});
  }

  /// The rank of a celebration, for example `Optional memorial`.
  String rankLabel(String rank) {
    final key = switch (rank) {
      'solemnity' => 'solemnity',
      'sunday' => 'sunday',
      'feast' => 'feast',
      'memorial' => 'memorial',
      'optional-memorial' => 'optionalMemorial',
      'commemoration' => 'commemoration',
      _ => 'weekday',
    };
    return _t('day_rank_$key');
  }

  /// The name of a liturgical colour, for example `Green`.
  String colourLabel(String colour) {
    const colours = {'white', 'red', 'violet', 'rose', 'black', 'gold'};
    return _t('day_colour_${colours.contains(colour) ? colour : 'green'}');
  }

  /// The rank with the colour named in words, `Sunday · Green`, so the
  /// colour is never told by a swatch alone.
  String rankAndColourLabel(String rank, String colour) {
    return '${rankLabel(rank)} · ${colourLabel(colour)}';
  }

  /// The label of a reading slot: `First reading`, `Psalm`, `Gospel`,
  /// `Reading 3`, `Psalm 2`, `Epistle`; otherwise `Reading`.
  String slotLabel(String slot) => slotLabelIn(_l10n, slot);

  /// `Sunday cycle A · Weekday cycle II`.
  String cyclesLabel(String sunday, String weekday) {
    return _t('day_cycles', {'sunday': sunday, 'weekday': weekday});
  }

  /// The note above the Masses of a day that has more than one.
  String massOptionsLabel(int count) {
    return _t('day_massOptions', {'count': count});
  }

  /// What a screen reader says for a reading's Notes button, which names the
  /// reading, since every card has one.
  String notesSemantics(String ref) => _t('app_today_notesLabel', {'ref': ref});

  /// What a screen reader says for a reading's link-out: the reference, the
  /// site it opens and that it leaves the app.
  String linkoutSemantics(String ref, Uri linkout) {
    return _t('app_today_linkoutLabel', {'ref': ref, 'source': linkout.host});
  }

  /// The ISO [date] written out, `Sunday 20 September 2026` (`Jumapili 20
  /// Septemba 2026` in Kiswahili).
  String formatDayDate(String date) => formatLongDate(date, languageCode);
}

final RegExp _numberedSlot = RegExp(r'^(reading|psalm)-(\d)$');

/// The label of a reading slot in [l10n]'s language, from the site's
/// `day.slot` messages: `First reading`, `Psalm 2`, `Reading 3`; otherwise
/// `Reading`.
String slotLabelIn(LectioLocalizations l10n, String slot) {
  final numbered = _numberedSlot.firstMatch(slot);
  if (numbered != null) {
    final n = numbered.group(2)!;
    final key = numbered.group(1) == 'psalm' ? 'psalmN' : 'readingN';
    return l10n.text('day_slot_$key', {'n': n});
  }
  final key = switch (slot) {
    'first-reading' => 'firstReading',
    'psalm' => 'psalm',
    'second-reading' => 'secondReading',
    'epistle' => 'epistle',
    'gospel' => 'gospel',
    _ => 'other',
  };
  return l10n.text('day_slot_$key');
}

/// The ISO [date] written out in [language]: `Sunday 20 September 2026`,
/// `Jumapili 20 Septemba 2026`.
String formatLongDate(String date, String language) {
  final locale = language == 'sw' ? 'sw' : 'en_US';
  return DateFormat('EEEE d MMMM y', locale).format(DateTime.parse(date));
}
