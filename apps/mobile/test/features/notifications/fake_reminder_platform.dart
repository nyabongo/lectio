import 'package:flutter/services.dart';
import 'package:lectio/features/notifications/celebration_source.dart';
import 'package:lectio/features/notifications/reminder_platform.dart';

/// A [ReminderPlatform] in memory that records every call.
class FakeReminderPlatform implements ReminderPlatform {
  /// What [requestPermission] answers.
  bool grantPermission = true;

  /// What [permissionGranted] answers.
  bool permissionAllowed = true;

  /// Runs while permission is being asked, before the answer.
  Future<void> Function()? whileAsking;

  /// Whether [schedule] fails like a broken plugin.
  bool failSchedules = false;

  /// Every call, in order: `initialize`, `requestPermission`,
  /// `schedule <id>` or `cancel <id>`.
  final List<String> calls = [];

  /// The pending reminders by id.
  final Map<int, ReminderNotification> pending = {};

  /// The pending reminders, by time.
  List<ReminderNotification> get scheduled {
    return pending.values.toList()..sort((a, b) => a.at.compareTo(b.at));
  }

  @override
  Future<void> initialize() async => calls.add('initialize');

  @override
  Future<bool> requestPermission() async {
    calls.add('requestPermission');
    await whileAsking?.call();
    return grantPermission;
  }

  @override
  Future<bool> permissionGranted() async {
    calls.add('permissionGranted');
    return permissionAllowed;
  }

  @override
  Future<void> schedule(ReminderNotification reminder) async {
    calls.add('schedule ${reminder.id}');
    if (failSchedules) throw PlatformException(code: 'broken');
    pending[reminder.id] = reminder;
  }

  @override
  Future<void> cancel(int id) async {
    calls.add('cancel $id');
    pending.remove(id);
  }
}

/// A [CelebrationSource] answering from a map of ISO dates to names.
class FakeCelebrations implements CelebrationSource {
  /// Creates a source knowing [names].
  new([Map<String, String>? names]) : names = names ?? {};

  /// The known celebrations by ISO date.
  final Map<String, String> names;

  /// The dates asked for, in order.
  final List<String> asked = [];

  /// The language of each question, in order.
  final List<String> languages = [];

  /// Dates whose answer waits for this future (forever when it never
  /// completes).
  final Map<String, Future<void>> holds = {};

  @override
  Future<String?> celebrationOn(String date, {String language = 'en'}) async {
    asked.add(date);
    languages.add(language);
    await holds[date];
    return names[date];
  }
}
