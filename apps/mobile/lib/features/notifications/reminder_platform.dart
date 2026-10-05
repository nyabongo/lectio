import 'package:flutter/foundation.dart';

/// One daily reminder to deliver at [at].
@immutable
class ReminderNotification {
  /// Creates a reminder.
  const new({
    required this.id,
    required this.at,
    required this.title,
    required this.body,
    required this.date,
  });

  /// The notification id, so it can be replaced or cancelled.
  final int id;

  /// When it arrives (an instant; the device's local time when scheduled).
  final DateTime at;

  /// The title: the day's celebration, or the app name.
  final String title;

  /// The text under the title.
  final String body;

  /// The ISO date the reminder is for, sent back as the payload on tap.
  final String date;

  @override
  bool operator ==(Object other) {
    return other is ReminderNotification &&
        other.id == id &&
        other.at == at &&
        other.title == title &&
        other.body == body &&
        other.date == date;
  }

  @override
  int get hashCode => Object.hash(id, at, title, body, date);

  @override
  String toString() => 'ReminderNotification($id, $at, $title, $date)';
}

/// The device's local notifications, as the daily reminder uses them.
///
/// `LocalNotificationsPlatform` implements it on flutter_local_notifications;
/// tests pass a fake.
abstract interface class ReminderPlatform {
  /// Prepares the plugin. Never asks for permission.
  Future<void> initialize();

  /// Asks the reader to allow notifications (Android 13+ and iOS) and
  /// completes with whether they are allowed.
  Future<bool> requestPermission();

  /// Schedules [reminder], replacing any pending one with the same id.
  Future<void> schedule(ReminderNotification reminder);

  /// Cancels the pending reminder with [id], if there is one.
  Future<void> cancel(int id);
}
