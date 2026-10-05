import 'package:app_links/app_links.dart';
import 'package:flutter/widgets.dart';
import 'package:lectio/data/app_repository.dart';
import 'package:lectio/features/bookmarks/bookmarks_controller.dart';
import 'package:lectio/features/notifications/daily_reminder_scheduler.dart';
import 'package:lectio/features/notifications/local_notifications_platform.dart';
import 'package:lectio/features/notifications/reminder_platform.dart';
import 'package:lectio/features/settings/key_value_store.dart';
import 'package:lectio/features/settings/settings_controller.dart';
import 'package:lectio/features/share/deep_links.dart';
import 'package:lectio/src/app.dart';

/// Starts the app with settings, bookmarks and notes saved on the device.
Future<void> main() => runLectio();

/// Starts the app as [main] does, with the daily reminder on
/// [reminderPlatform] (default: the device's notifications, whose taps open
/// the day) and incoming [links] (default: app_links' site and `lectio://`
/// links), for tests.
Future<void> runLectio({
  ReminderPlatform? reminderPlatform,
  Stream<Uri>? links,
}) async {
  WidgetsFlutterBinding.ensureInitialized();
  // Listen first, so the link that launched the app is not missed.
  final deepLinks = DeepLinks()..listen(links ?? AppLinks().uriLinkStream);
  final store = await openDeviceStore();
  final settings = SettingsController(store);
  runApp(
    LectioApp(
      settings: settings,
      bookmarks: BookmarksController(store),
      reminders: startDailyReminders(
        settings: settings,
        repository: appRepository,
        platform:
            reminderPlatform ??
            LocalNotificationsPlatform(onOpen: deepLinks.openReminder),
      ),
      links: deepLinks,
    ),
  );
}
