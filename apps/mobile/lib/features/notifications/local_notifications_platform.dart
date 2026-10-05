import 'package:flutter/services.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:lectio/features/notifications/reminder_platform.dart';
import 'package:timezone/timezone.dart' as tz;

/// The Android notification channel the daily reminder posts to.
const AndroidNotificationDetails dailyReminderChannel =
    AndroidNotificationDetails(
      'daily-reminder',
      'Daily reminder',
      channelDescription: "A daily nudge to open the day's readings.",
    );

/// [ReminderPlatform] on flutter_local_notifications.
///
/// Reminders are one-off notifications at an instant, sent in UTC: the
/// scheduler works out each date's local time with the device's own time
/// zone rules, so no time zone database or device zone lookup is needed.
/// Android alarms are inexact (`inexactAllowWhileIdle`), which needs no
/// exact-alarm permission; a reminder may arrive a few minutes late.
class LocalNotificationsPlatform implements ReminderPlatform {
  /// Creates the platform on [plugin] (default: the plugin's instance).
  new({FlutterLocalNotificationsPlugin? plugin})
    : _plugin = plugin ?? FlutterLocalNotificationsPlugin();

  final FlutterLocalNotificationsPlugin _plugin;

  Future<void>? _initialized;

  @override
  Future<void> initialize() => _initialized ??= _initialize();

  Future<void> _initialize() async {
    await _plugin.initialize(
      settings: const InitializationSettings(
        android: AndroidInitializationSettings('@mipmap/ic_launcher'),
        // Permission is asked only when the reader turns the reminder on.
        iOS: DarwinInitializationSettings(
          requestAlertPermission: false,
          requestSoundPermission: false,
          requestBadgePermission: false,
        ),
      ),
    );
  }

  @override
  Future<bool> requestPermission() {
    return _ask(
      android: (android) => android.requestNotificationsPermission(),
      ios: (ios) => ios.requestPermissions(alert: true, sound: true),
    );
  }

  @override
  Future<bool> permissionGranted() {
    return _ask(
      android: (android) => android.areNotificationsEnabled(),
      ios: (ios) async => (await ios.checkPermissions())?.isEnabled,
    );
  }

  /// Runs [android] or [ios] on the current platform's plugin; `false` on
  /// other platforms, when there is no answer or when the plugin fails (for
  /// example a permission request already in progress).
  Future<bool> _ask({
    required Future<bool?> Function(AndroidFlutterLocalNotificationsPlugin)
    android,
    required Future<bool?> Function(IOSFlutterLocalNotificationsPlugin) ios,
  }) async {
    try {
      final onAndroid = _plugin
          .resolvePlatformSpecificImplementation<
            AndroidFlutterLocalNotificationsPlugin
          >();
      if (onAndroid != null) return await android(onAndroid) ?? false;
      final onIos = _plugin
          .resolvePlatformSpecificImplementation<
            IOSFlutterLocalNotificationsPlugin
          >();
      if (onIos != null) return await ios(onIos) ?? false;
      return false;
    } on PlatformException {
      return false;
    }
  }

  @override
  Future<void> schedule(ReminderNotification reminder) {
    return _plugin.zonedSchedule(
      id: reminder.id,
      scheduledDate: tz.TZDateTime.from(reminder.at, tz.UTC),
      notificationDetails: const NotificationDetails(
        android: dailyReminderChannel,
        iOS: DarwinNotificationDetails(),
      ),
      androidScheduleMode: AndroidScheduleMode.inexactAllowWhileIdle,
      title: reminder.title,
      body: reminder.body,
      payload: reminder.date,
    );
  }

  @override
  Future<void> cancel(int id) => _plugin.cancel(id: id);
}
