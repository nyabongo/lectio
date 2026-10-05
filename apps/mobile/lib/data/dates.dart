/// Device-date helpers for the day documents.
library;

String _pad(int value, int width) => '$value'.padLeft(width, '0');

/// The calendar date of [time] as ISO `yyyy-mm-dd`.
String isoDate(DateTime time) {
  return '${_pad(time.year, 4)}-${_pad(time.month, 2)}-${_pad(time.day, 2)}';
}

/// ISO dates of the [count] days starting on the calendar date of [from].
///
/// Day arithmetic goes through the calendar fields, so a daylight-saving
/// change never skips or repeats a date.
List<String> upcomingDates(DateTime from, int count) {
  return [
    for (var offset = 0; offset < count; offset++)
      isoDate(DateTime(from.year, from.month, from.day + offset)),
  ];
}
