import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lectio/data/api_cache.dart';
import 'package:lectio/data/api_client.dart';
import 'package:lectio/data/repository.dart';
import 'package:lectio/features/notifications/daily_reminder_scheduler.dart';
import 'package:lectio/features/notifications/local_notifications_platform.dart';
import 'package:lectio/features/notifications/reminder_platform.dart';
import 'package:lectio/features/settings/key_value_store.dart';
import 'package:lectio/features/settings/settings_controller.dart';

import '../../data/fake_api.dart';

const _channel = MethodChannel('dexterous.com/flutter/local_notifications');

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late List<MethodCall> calls;
  late Object? Function(MethodCall call) answer;

  setUp(() {
    calls = [];
    // The plugin's initialize completes with whether it worked.
    answer = (call) => call.method == 'initialize' ? true : null;
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(_channel, (call) async {
          calls.add(call);
          return answer(call);
        });
  });

  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(_channel, null);
    debugDefaultTargetPlatformOverride = null;
  });

  Map<Object?, Object?> argumentsOf(MethodCall call) {
    return call.arguments as Map<Object?, Object?>;
  }

  group('on Android', () {
    setUp(() {
      debugDefaultTargetPlatformOverride = TargetPlatform.android;
      AndroidFlutterLocalNotificationsPlugin.registerWith();
    });

    test('initializes once, with the launcher icon', () async {
      final platform = LocalNotificationsPlatform();
      await platform.initialize();
      await platform.initialize();
      expect(calls.map((call) => call.method), ['initialize']);
      expect(argumentsOf(calls.single)['defaultIcon'], '@mipmap/ic_launcher');
    });

    test('asks for the notification permission', () async {
      final platform = LocalNotificationsPlatform();
      answer = (_) => true;
      expect(await platform.requestPermission(), isTrue);
      expect(calls.single.method, 'requestNotificationsPermission');

      answer = (_) => false;
      expect(await platform.requestPermission(), isFalse);
      answer = (_) => null;
      expect(await platform.requestPermission(), isFalse);
    });

    test('checks whether notifications are allowed, without asking', () async {
      final platform = LocalNotificationsPlatform();
      answer = (_) => true;
      expect(await platform.permissionGranted(), isTrue);
      expect(calls.single.method, 'areNotificationsEnabled');

      answer = (_) => null;
      expect(await platform.permissionGranted(), isFalse);
    });

    test('a failed permission request counts as refused', () async {
      answer = (_) => throw PlatformException(code: 'inProgress');
      expect(await LocalNotificationsPlatform().requestPermission(), isFalse);
    });

    test('schedules an inexact one-off reminder at the instant', () async {
      final at = DateTime.utc(2100, 9, 20, 4);
      await LocalNotificationsPlatform().schedule(
        ReminderNotification(
          id: 1060,
          at: at.toLocal(),
          title: 'Twenty-fifth Sunday in Ordinary Time',
          body: ReminderStrings.en.body,
          date: '2100-09-20',
        ),
      );
      final call = calls.single;
      expect(call.method, 'zonedSchedule');
      final arguments = argumentsOf(call);
      expect(arguments['id'], 1060);
      expect(arguments['title'], 'Twenty-fifth Sunday in Ordinary Time');
      expect(arguments['body'], ReminderStrings.en.body);
      expect(arguments['payload'], '2100-09-20');
      expect(arguments['timeZoneName'], 'Etc/UTC');
      expect(arguments['scheduledDateTime'], '2100-09-20T04:00:00');
      expect(arguments.containsKey('matchDateTimeComponents'), isFalse);
      final specifics =
          arguments['platformSpecifics']! as Map<Object?, Object?>;
      expect(specifics['scheduleMode'], 'inexactAllowWhileIdle');
      expect(specifics['channelId'], dailyReminderChannel.channelId);
    });

    test('cancels by id', () async {
      await LocalNotificationsPlatform().cancel(1063);
      expect(calls.single.method, 'cancel');
      expect(argumentsOf(calls.single)['id'], 1063);
    });

    test('startDailyReminders uses the device notifications', () async {
      final scheduler = startDailyReminders(
        settings: SettingsController(MemoryKeyValueStore()),
        repository: LectioRepository(
          client: ApiClient(
            httpClient: FakeApi().client,
            baseUrl: FakeApi.baseUrl,
          ),
          cache: MemoryApiCache(),
        ),
      );
      await scheduler.idle;
      expect(scheduler.lastError, isNull);
      expect(calls.first.method, 'initialize');
      // The reminder is off by default: old reminders are cleared.
      expect(calls.skip(1).map((call) => call.method).toSet(), {'cancel'});
      expect(calls, hasLength(1 + reminderDays));
    });
  });

  group('on iOS', () {
    setUp(() {
      debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
      IOSFlutterLocalNotificationsPlugin.registerWith();
    });

    test('does not ask for permission when initializing', () async {
      await LocalNotificationsPlatform().initialize();
      final arguments = argumentsOf(calls.single);
      expect(calls.single.method, 'initialize');
      expect(arguments['requestAlertPermission'], isFalse);
      expect(arguments['requestSoundPermission'], isFalse);
      expect(arguments['requestBadgePermission'], isFalse);
    });

    test('asks for alerts and sounds', () async {
      final platform = LocalNotificationsPlatform();
      answer = (_) => true;
      expect(await platform.requestPermission(), isTrue);
      final call = calls.single;
      expect(call.method, 'requestPermissions');
      expect(argumentsOf(call)['alert'], isTrue);
      expect(argumentsOf(call)['sound'], isTrue);
      expect(argumentsOf(call)['badge'], isFalse);

      answer = (_) => null;
      expect(await platform.requestPermission(), isFalse);
    });

    test('checks whether notifications are enabled', () async {
      final platform = LocalNotificationsPlatform();
      answer = (_) => {'isEnabled': true};
      expect(await platform.permissionGranted(), isTrue);
      expect(calls.single.method, 'checkPermissions');

      answer = (_) => {'isEnabled': false};
      expect(await platform.permissionGranted(), isFalse);
      answer = (_) => null;
      expect(await platform.permissionGranted(), isFalse);
    });
  });

  test('elsewhere, permission is never granted', () async {
    debugDefaultTargetPlatformOverride = TargetPlatform.fuchsia;
    expect(await LocalNotificationsPlatform().requestPermission(), isFalse);
    expect(calls, isEmpty);
  });
}
