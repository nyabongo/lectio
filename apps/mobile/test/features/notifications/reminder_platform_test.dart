import 'package:flutter_test/flutter_test.dart';
import 'package:lectio/features/notifications/daily_reminder_scheduler.dart';
import 'package:lectio/features/notifications/reminder_platform.dart';

void main() {
  group('ReminderNotification', () {
    ReminderNotification reminder({String title = 'Lectio'}) {
      return ReminderNotification(
        id: 1060,
        at: DateTime(2026, 9, 20, 7),
        title: title,
        body: ReminderStrings.en.body,
        date: '2026-09-20',
      );
    }

    test('compares by value', () {
      expect(reminder(), reminder());
      expect(reminder().hashCode, reminder().hashCode);
      expect(reminder(), isNot(reminder(title: 'Other')));
    });

    test('describes itself', () {
      expect(
        reminder().toString(),
        'ReminderNotification(1060, ${DateTime(2026, 9, 20, 7)}, Lectio, '
        '2026-09-20)',
      );
    });
  });
}
