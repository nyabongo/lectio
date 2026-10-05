import 'package:flutter/widgets.dart';
import 'package:lectio/data/app_repository.dart';
import 'package:lectio/features/bookmarks/bookmarks_controller.dart';
import 'package:lectio/features/notifications/daily_reminder_scheduler.dart';
import 'package:lectio/features/notifications/reminder_platform.dart';
import 'package:lectio/features/settings/key_value_store.dart';
import 'package:lectio/features/settings/settings_controller.dart';
import 'package:lectio/src/app.dart';

/// Starts the app with settings, bookmarks and notes saved on the device.
Future<void> main() => runLectio();

/// Starts the app as [main] does, with the daily reminder on
/// [reminderPlatform] (default: the device's notifications), for tests.
Future<void> runLectio({ReminderPlatform? reminderPlatform}) async {
  WidgetsFlutterBinding.ensureInitialized();
  final store = await openDeviceStore();
  final settings = SettingsController(store);
  runApp(
    LectioApp(
      settings: settings,
      bookmarks: BookmarksController(store),
      reminders: startDailyReminders(
        settings: settings,
        repository: appRepository,
        platform: reminderPlatform,
      ),
    ),
  );
}
