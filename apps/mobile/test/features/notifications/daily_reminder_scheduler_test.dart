import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lectio/data/api_cache.dart';
import 'package:lectio/data/api_client.dart';
import 'package:lectio/data/repository.dart';
import 'package:lectio/features/notifications/daily_reminder_scheduler.dart';
import 'package:lectio/features/notifications/reminder_platform.dart';
import 'package:lectio/features/settings/app_settings.dart';
import 'package:lectio/features/settings/key_value_store.dart';
import 'package:lectio/features/settings/settings_controller.dart';

import '../../data/fake_api.dart';
import 'fake_reminder_platform.dart';

const _cancelAll = [
  'cancel 1060',
  'cancel 1061',
  'cancel 1062',
  'cancel 1063',
  'cancel 1064',
  'cancel 1065',
  'cancel 1066',
];

const _scheduleAll = [
  'schedule 1060',
  'schedule 1061',
  'schedule 1062',
  'schedule 1063',
  'schedule 1064',
  'schedule 1065',
  'schedule 1066',
];

SettingsController _settingsWith({required bool reminder, String? time}) {
  return SettingsController(
    MemoryKeyValueStore({
      SettingsController.storageKey:
          '{"version":1,"dailyReminder":$reminder,'
          '"reminderTime":"${time ?? '07:00'}"}',
    }),
  );
}

/// Collects what is reported to [FlutterError.reportError] during the test.
List<FlutterErrorDetails> _captureReports() {
  final reports = <FlutterErrorDetails>[];
  final previous = FlutterError.onError;
  FlutterError.onError = reports.add;
  addTearDown(() => FlutterError.onError = previous);
  return reports;
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('upcomingReminderTimes', () {
    test('starts today when the time is still ahead', () {
      final times = upcomingReminderTimes(
        DateTime(2026, 9, 20, 6, 30),
        const TimeOfDay(hour: 7, minute: 0),
      );
      expect(times, [
        for (var day = 20; day <= 26; day++) DateTime(2026, 9, day, 7),
      ]);
    });

    test('starts tomorrow when the time has passed', () {
      final times = upcomingReminderTimes(
        DateTime(2026, 9, 20, 7, 30),
        const TimeOfDay(hour: 7, minute: 0),
        count: 2,
      );
      expect(times, [DateTime(2026, 9, 21, 7), DateTime(2026, 9, 22, 7)]);
    });

    test('skips a time less than a minute away', () {
      final times = upcomingReminderTimes(
        DateTime(2026, 9, 20, 6, 59, 30),
        const TimeOfDay(hour: 7, minute: 0),
        count: 1,
      );
      expect(times, [DateTime(2026, 9, 21, 7)]);
    });

    test('crosses month and year ends by calendar date', () {
      final times = upcomingReminderTimes(
        DateTime(2026, 12, 30, 22),
        const TimeOfDay(hour: 21, minute: 15),
        count: 3,
      );
      expect(times, [
        DateTime(2026, 12, 31, 21, 15),
        DateTime(2027, 1, 1, 21, 15),
        DateTime(2027, 1, 2, 21, 15),
      ]);
    });
  });

  group('DailyReminderScheduler', () {
    late FakeReminderPlatform platform;
    late FakeCelebrations celebrations;
    late DateTime now;

    DailyReminderScheduler schedulerFor(SettingsController settings) {
      return DailyReminderScheduler(
        settings: settings,
        platform: platform,
        celebrations: celebrations,
        clock: () => now,
      );
    }

    setUp(() {
      platform = FakeReminderPlatform();
      celebrations = FakeCelebrations({
        '2026-09-20': 'Twenty-fifth Sunday in Ordinary Time',
        '2026-09-21': 'Saint Matthew, Apostle and Evangelist',
      });
      now = DateTime(2026, 9, 20, 6, 30);
    });

    test('with the reminder off, start-up only clears old reminders', () async {
      final scheduler = schedulerFor(_settingsWith(reminder: false));
      await scheduler.start();
      expect(platform.calls, ['initialize', ..._cancelAll]);
      expect(platform.pending, isEmpty);
      expect(celebrations.asked, isEmpty);
    });

    test('with the reminder on, start-up schedules the next 7 days '
        'without asking for permission', () async {
      final scheduler = schedulerFor(_settingsWith(reminder: true));
      await scheduler.start();
      expect(platform.calls, ['initialize', ..._scheduleAll]);
      expect(platform.scheduled, [
        ReminderNotification(
          id: 1060,
          at: DateTime(2026, 9, 20, 7),
          title: 'Twenty-fifth Sunday in Ordinary Time',
          body: ReminderStrings.body,
          date: '2026-09-20',
        ),
        ReminderNotification(
          id: 1061,
          at: DateTime(2026, 9, 21, 7),
          title: 'Saint Matthew, Apostle and Evangelist',
          body: ReminderStrings.body,
          date: '2026-09-21',
        ),
        for (var day = 22; day <= 26; day++)
          ReminderNotification(
            id: 1060 + day - 20,
            at: DateTime(2026, 9, day, 7),
            title: ReminderStrings.fallbackTitle,
            body: ReminderStrings.body,
            date: '2026-09-$day',
          ),
      ]);
      expect(celebrations.asked, [
        for (var day = 20; day <= 26; day++) '2026-09-$day',
      ]);
    });

    test('starts once', () async {
      final scheduler = schedulerFor(_settingsWith(reminder: false));
      await scheduler.start();
      await scheduler.start();
      expect(
        platform.calls.where((call) => call == 'initialize'),
        hasLength(1),
      );
    });

    test(
      'turning the reminder on asks for permission, then schedules',
      () async {
        final settings = _settingsWith(reminder: false);
        final scheduler = schedulerFor(settings);
        await scheduler.start();
        platform.calls.clear();

        await settings.update(settings.settings.copyWith(dailyReminder: true));
        await scheduler.idle;

        expect(platform.calls, ['requestPermission', ..._scheduleAll]);
        expect(platform.scheduled.first.at, DateTime(2026, 9, 20, 7));
        expect(settings.settings.dailyReminder, isTrue);
      },
    );

    test('a refused permission switches the reminder back off', () async {
      final settings = _settingsWith(reminder: false);
      final scheduler = schedulerFor(settings);
      await scheduler.start();
      platform
        ..calls.clear()
        ..grantPermission = false;
      final refusals = <void>[];
      scheduler.permissionRefusals.listen(refusals.add);

      await settings.update(settings.settings.copyWith(dailyReminder: true));
      await scheduler.idle;
      await scheduler.idle;

      expect(settings.settings.dailyReminder, isFalse);
      expect(platform.calls, ['requestPermission', ..._cancelAll]);
      expect(platform.pending, isEmpty);
      expect(refusals, hasLength(1));
    });

    test('a refusal after dispose still switches off, silently', () async {
      final settings = _settingsWith(reminder: false);
      final scheduler = schedulerFor(settings);
      await scheduler.start();
      var refused = false;
      scheduler.permissionRefusals.listen((_) => refused = true);
      platform
        ..grantPermission = false
        ..whileAsking = () async => scheduler.dispose();

      await settings.update(settings.settings.copyWith(dailyReminder: true));
      await scheduler.idle;

      expect(settings.settings.dailyReminder, isFalse);
      expect(refused, isFalse);
    });

    test('following the app, a resume reschedules', () async {
      final settings = _settingsWith(reminder: true);
      final scheduler = schedulerFor(settings);
      await scheduler.start();
      scheduler
        ..followAppResume()
        ..followAppResume();
      platform.calls.clear();
      now = DateTime(2026, 9, 22, 9);

      final binding = TestWidgetsFlutterBinding.instance
        ..handleAppLifecycleStateChanged(AppLifecycleState.inactive)
        ..handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await scheduler.idle;
      expect(platform.calls, ['permissionGranted', ..._scheduleAll]);
      expect(platform.scheduled.first.date, '2026-09-23');

      scheduler.dispose();
      platform.calls.clear();
      binding
        ..handleAppLifecycleStateChanged(AppLifecycleState.inactive)
        ..handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await scheduler.idle;
      expect(platform.calls, isEmpty);
    });

    test('a resume after notifications were turned off in the system '
        'settings switches the reminder off and says why', () async {
      final settings = _settingsWith(reminder: true);
      final scheduler = schedulerFor(settings);
      await scheduler.start();
      final refusals = <void>[];
      scheduler.permissionRefusals.listen(refusals.add);
      platform
        ..calls.clear()
        ..permissionAllowed = false;

      await scheduler.resumed();
      await scheduler.idle;

      expect(settings.settings.dailyReminder, isFalse);
      expect(refusals, hasLength(1));
      expect(platform.calls, ['permissionGranted', ..._cancelAll]);
      expect(platform.pending, isEmpty);
    });

    test('with the reminder off, a resume does not check permission', () async {
      final scheduler = schedulerFor(_settingsWith(reminder: false));
      await scheduler.start();
      platform.calls.clear();

      await scheduler.resumed();

      expect(platform.calls, _cancelAll);
    });

    test('reads the celebrations of all 7 days at once', () async {
      final release = Completer<void>();
      for (var day = 20; day <= 26; day++) {
        celebrations.holds['2026-09-$day'] = release.future;
      }
      final scheduler = schedulerFor(_settingsWith(reminder: true));
      final started = scheduler.start();
      await pumpEventQueue();

      expect(celebrations.asked, hasLength(reminderDays));
      expect(platform.pending, isEmpty);

      release.complete();
      await started;
      expect(platform.pending, hasLength(reminderDays));
    });

    test('a day whose celebration is slow gets the fallback title', () async {
      celebrations.holds['2026-09-20'] = Completer<void>().future;
      final scheduler = DailyReminderScheduler(
        settings: _settingsWith(reminder: true),
        platform: platform,
        celebrations: celebrations,
        clock: () => now,
        celebrationTimeout: const Duration(milliseconds: 10),
      );
      expect(
        DailyReminderScheduler(
          settings: _settingsWith(reminder: false),
          platform: platform,
          celebrations: celebrations,
        ).celebrationTimeout,
        defaultCelebrationTimeout,
      );

      await scheduler.start();

      expect(platform.scheduled.first.title, ReminderStrings.fallbackTitle);
      expect(
        platform.scheduled[1].title,
        'Saint Matthew, Apostle and Evangelist',
      );
    });

    testWidgets('DailyReminderScope gives the scheduler to its subtree', (
      tester,
    ) async {
      final scheduler = schedulerFor(_settingsWith(reminder: false));
      DailyReminderScheduler? found;
      DailyReminderScheduler? outside;
      await tester.pumpWidget(
        Builder(
          builder: (context) {
            outside = DailyReminderScope.maybeOf(context);
            return DailyReminderScope(
              scheduler: scheduler,
              child: Builder(
                builder: (context) {
                  found = DailyReminderScope.maybeOf(context);
                  return const SizedBox();
                },
              ),
            );
          },
        ),
      );
      expect(found, same(scheduler));
      expect(outside, isNull);

      final other = schedulerFor(_settingsWith(reminder: false));
      final scope = DailyReminderScope(
        scheduler: scheduler,
        child: const SizedBox(),
      );
      expect(
        scope.updateShouldNotify(
          DailyReminderScope(scheduler: other, child: const SizedBox()),
        ),
        isTrue,
      );
      expect(scope.updateShouldNotify(scope), isFalse);
    });

    test('a refusal after the reader switched off changes nothing', () async {
      final settings = _settingsWith(reminder: false);
      final scheduler = schedulerFor(settings);
      await scheduler.start();
      platform
        ..calls.clear()
        ..grantPermission = false
        ..whileAsking = () =>
            settings.update(settings.settings.copyWith(dailyReminder: false));

      await settings.update(settings.settings.copyWith(dailyReminder: true));
      await scheduler.idle;
      await scheduler.idle;

      expect(settings.settings.dailyReminder, isFalse);
      expect(platform.calls, ['requestPermission', ..._cancelAll]);
    });

    test('a new time reschedules without asking again', () async {
      final settings = _settingsWith(reminder: true);
      final scheduler = schedulerFor(settings);
      await scheduler.start();
      platform.calls.clear();

      await settings.update(
        settings.settings.copyWith(
          reminderTime: const TimeOfDay(hour: 6, minute: 0),
        ),
      );
      await scheduler.idle;

      expect(platform.calls, _scheduleAll);
      expect(platform.scheduled.first.at, DateTime(2026, 9, 21, 6));
      expect(platform.scheduled.last.at, DateTime(2026, 9, 27, 6));
    });

    test('turning the reminder off cancels every reminder', () async {
      final settings = _settingsWith(reminder: true);
      final scheduler = schedulerFor(settings);
      await scheduler.start();
      platform.calls.clear();

      await settings.update(settings.settings.copyWith(dailyReminder: false));
      await scheduler.idle;

      expect(platform.calls, _cancelAll);
      expect(platform.pending, isEmpty);
    });

    test('other settings leave the reminders alone', () async {
      final settings = _settingsWith(reminder: true);
      final scheduler = schedulerFor(settings);
      await scheduler.start();
      platform.calls.clear();

      await settings.update(
        settings.settings.copyWith(theme: ThemePreference.dark),
      );
      await scheduler.idle;

      expect(platform.calls, isEmpty);
    });

    test('reschedule uses the celebrations known now', () async {
      final settings = _settingsWith(reminder: true);
      final scheduler = schedulerFor(settings);
      await scheduler.start();
      celebrations.names['2026-09-22'] = 'Saint Pius of Pietrelcina';
      now = DateTime(2026, 9, 21, 8);

      await scheduler.reschedule();

      expect(platform.scheduled.first.date, '2026-09-22');
      expect(platform.scheduled.first.title, 'Saint Pius of Pietrelcina');
      expect(platform.scheduled.last.date, '2026-09-28');
      expect(platform.pending, hasLength(reminderDays));
    });

    test('a failure is reported and kept; the next task still runs', () async {
      final reports = _captureReports();
      final settings = _settingsWith(reminder: true);
      final scheduler = schedulerFor(settings);
      platform.failSchedules = true;
      await scheduler.start();
      expect(scheduler.lastError, isA<PlatformException>());
      expect(reports, hasLength(1));
      final report = reports.single;
      expect(report.exception, same(scheduler.lastError));
      expect(report.stack, isNotNull);
      expect(report.library, 'lectio notifications');
      expect(
        report.context.toString(),
        contains('while scheduling the daily reminder'),
      );

      platform.failSchedules = false;
      await scheduler.reschedule();
      expect(platform.pending, hasLength(reminderDays));
    });

    test('after dispose, settings changes are not followed', () async {
      final settings = _settingsWith(reminder: true);
      final scheduler = schedulerFor(settings);
      await scheduler.start();
      scheduler.dispose();
      platform.calls.clear();

      await settings.update(settings.settings.copyWith(dailyReminder: false));
      await scheduler.idle;

      expect(platform.calls, isEmpty);
    });
  });

  test('startDailyReminders titles reminders from the repository', () async {
    final api = FakeApi();
    final platform = FakeReminderPlatform();
    final scheduler = startDailyReminders(
      settings: _settingsWith(reminder: true),
      repository: LectioRepository(
        client: ApiClient(httpClient: api.client, baseUrl: FakeApi.baseUrl),
        cache: MemoryApiCache(),
      ),
      platform: platform,
    );
    await scheduler.idle;

    expect(platform.calls.first, 'initialize');
    expect(platform.pending, hasLength(reminderDays));
    // The fake API publishes no days, so every title falls back.
    expect(platform.scheduled.map((reminder) => reminder.title).toSet(), {
      ReminderStrings.fallbackTitle,
    });
    expect(api.paths, hasLength(reminderDays));
  });
}
