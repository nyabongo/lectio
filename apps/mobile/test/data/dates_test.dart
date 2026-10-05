import 'package:flutter_test/flutter_test.dart';
import 'package:lectio/data/dates.dart';

void main() {
  test('isoDate pads every field', () {
    expect(isoDate(DateTime(2026, 9, 5, 23, 59)), '2026-09-05');
    expect(isoDate(DateTime(987, 12, 25)), '0987-12-25');
  });

  test('upcomingDates counts calendar days across months and years', () {
    expect(upcomingDates(DateTime(2026, 12, 29, 22), 5), [
      '2026-12-29',
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
      '2027-01-02',
    ]);
  });

  test('upcomingDates of zero days is empty', () {
    expect(upcomingDates(DateTime(2026, 9, 20), 0), isEmpty);
  });
}
