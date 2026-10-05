import 'package:intl/intl.dart';

/// The English strings of the Today screen, worded as on the site
/// (`apps/web/src/i18n/en/day.json`). L-114 moves them to the l10n catalog.
abstract final class TodayStrings {
  /// The eyebrow above the date when it is the device's date.
  static const String todayHeading = 'Today';

  /// Goes back to the device's date from another day.
  static const String backToToday = 'Back to today';

  /// Tooltip of the date button, which opens the date picker.
  static const String chooseDate = 'Choose a date';

  /// The Listen button.
  static const String listen = 'Listen to the notes';

  /// The button that opens a reading's notes.
  static const String notes = 'Notes';

  /// The link-out to the licensed text of a reading.
  static const String text = 'Text ↗';

  /// A reading without approved notes.
  static const String notesInPreparation = 'Notes in preparation';

  /// A day whose readings all lack approved notes.
  static const String notesMissing =
      'Notes for this day are in preparation. Each text is a tap away.';

  /// A day the lectionary has no readings for.
  static const String lectionaryMissing =
      'The readings for this day are not listed yet.';

  /// A day without any Mass (Holy Saturday).
  static const String noMass =
      'No Mass is celebrated on this day. The Easter Vigil, held after '
      'nightfall, belongs to Easter Sunday, and its readings are listed there.';

  /// A date the API publishes no day document for.
  static const String emptyDay =
      'There is no calendar day for this date yet. The calendar lists every '
      'day that is ready.';

  /// The day could not be fetched and nothing is saved on the device.
  static const String loadFailed =
      'The day could not be loaded. Check your connection and try again.';

  /// Retries loading the day.
  static const String retry = 'Try again';

  /// A saved day is shown because the network could not be reached.
  static const String offline =
      'Offline: showing the copy saved on this device.';

  /// A saved day is shown because the server answered with an error.
  static const String refreshFailed =
      'The day could not be refreshed: showing the copy saved on this '
      'device.';

  /// The link-out could not be opened.
  static const String linkFailed = 'The text could not be opened.';
}

/// The season name, for example `Ordinary Time`.
String seasonName(String season) {
  return switch (season) {
    'advent' => 'Advent',
    'christmas' => 'Christmas Time',
    'lent' => 'Lent',
    'paschal-triduum' => 'Paschal Triduum',
    'easter' => 'Easter Time',
    _ => 'Ordinary Time',
  };
}

/// The season with its week, `Ordinary Time · Week 25`; week 0 (the days
/// before a season's first Sunday) is left out.
String seasonLabel(String season, int week) {
  final name = seasonName(season);
  return week > 0 ? '$name · Week $week' : name;
}

/// The rank of a celebration, for example `Optional memorial`.
String rankLabel(String rank) {
  return switch (rank) {
    'solemnity' => 'Solemnity',
    'sunday' => 'Sunday',
    'feast' => 'Feast',
    'memorial' => 'Memorial',
    'optional-memorial' => 'Optional memorial',
    'commemoration' => 'Commemoration',
    _ => 'Weekday',
  };
}

/// The name of a liturgical colour, for example `Green`.
String colourLabel(String colour) {
  return switch (colour) {
    'white' => 'White',
    'red' => 'Red',
    'violet' => 'Violet',
    'rose' => 'Rose',
    'black' => 'Black',
    'gold' => 'Gold',
    _ => 'Green',
  };
}

/// The rank with the colour named in words, `Sunday · Green`, so the colour
/// is never told by a swatch alone.
String rankAndColourLabel(String rank, String colour) {
  return '${rankLabel(rank)} · ${colourLabel(colour)}';
}

final RegExp _numberedSlot = RegExp(r'^(reading|psalm)-(\d)$');

/// The label of a reading slot: `First reading`, `Psalm`, `Gospel`,
/// `Reading 3`, `Psalm 2`, `Epistle`; otherwise `Reading`.
String slotLabel(String slot) {
  final numbered = _numberedSlot.firstMatch(slot);
  if (numbered != null) {
    final n = numbered.group(2);
    return numbered.group(1) == 'psalm' ? 'Psalm $n' : 'Reading $n';
  }
  return switch (slot) {
    'first-reading' => 'First reading',
    'psalm' => 'Psalm',
    'second-reading' => 'Second reading',
    'epistle' => 'Epistle',
    'gospel' => 'Gospel',
    _ => 'Reading',
  };
}

/// `Sunday cycle A · Weekday cycle II`.
String cyclesLabel(String sunday, String weekday) {
  return 'Sunday cycle $sunday · Weekday cycle $weekday';
}

/// The note above the Masses of a day that has more than one.
String massOptionsLabel(int count) {
  return 'This day has $count Masses to choose from.';
}

/// What a screen reader says for a reading's Notes button, which names the
/// reading, since every card has one.
String notesSemantics(String ref) => 'Notes on $ref';

/// What a screen reader says for a reading's link-out: the reference, the
/// site it opens and that it leaves the app.
String linkoutSemantics(String ref, Uri linkout) {
  return 'Text of $ref at ${linkout.host} (opens outside the app)';
}

/// The ISO [date] written out, `Sunday 20 September 2026`.
String formatDayDate(String date) {
  return DateFormat('EEEE d MMMM y', 'en_US').format(DateTime.parse(date));
}
