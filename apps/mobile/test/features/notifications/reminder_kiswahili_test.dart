import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:lectio/data/api_cache.dart';
import 'package:lectio/data/api_client.dart';
import 'package:lectio/data/repository.dart';
import 'package:lectio/features/notifications/celebration_source.dart';
import 'package:lectio/features/notifications/daily_reminder_scheduler.dart';
import 'package:lectio/features/settings/app_settings.dart';
import 'package:lectio/features/settings/key_value_store.dart';
import 'package:lectio/features/settings/settings_controller.dart';

import '../../data/fake_api.dart';
import '../../data/fixtures.dart';
import 'fake_reminder_platform.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('ReminderStrings come in the reader language', () {
    final sw = ReminderStrings.forLanguage(AppLanguage.sw);
    expect(sw.fallbackTitle, 'Lectio');
    expect(sw.body, 'Masomo na madokezo ya leo yako tayari.');
    expect(sw.permissionRefused, startsWith('Arifa haziruhusiwi'));
    expect(ReminderStrings.en.body, "Today's readings and notes are ready.");
  });

  group('DailyReminderScheduler in Kiswahili', () {
    late FakeReminderPlatform platform;
    late FakeCelebrations celebrations;
    late SettingsController settings;
    late DailyReminderScheduler scheduler;

    setUp(() {
      platform = FakeReminderPlatform();
      celebrations = FakeCelebrations({
        '2026-09-20': 'Dominika ya 25 ya Mwaka',
      });
      settings = SettingsController(MemoryKeyValueStore());
      scheduler = DailyReminderScheduler(
        settings: settings,
        platform: platform,
        celebrations: celebrations,
        clock: () => DateTime(2026, 9, 20, 6, 30),
      );
      addTearDown(scheduler.dispose);
    });

    test('titles and words the reminders in Kiswahili', () async {
      await settings.update(
        const AppSettings(dailyReminder: true, language: AppLanguage.sw),
      );
      await scheduler.start();

      final reminders = platform.scheduled;
      expect(reminders, hasLength(reminderDays));
      expect(reminders.first.title, 'Dominika ya 25 ya Mwaka');
      expect(reminders[1].title, 'Lectio');
      expect(reminders.map((reminder) => reminder.body).toSet(), {
        'Masomo na madokezo ya leo yako tayari.',
      });
      expect(celebrations.languages.toSet(), {'sw'});
    });

    test('reschedules when the language changes', () async {
      await settings.update(const AppSettings(dailyReminder: true));
      await scheduler.start();
      expect(platform.scheduled.first.body, ReminderStrings.en.body);

      await settings.update(
        settings.settings.copyWith(language: AppLanguage.sw),
      );
      await scheduler.idle;

      expect(
        platform.scheduled.first.body,
        'Masomo na madokezo ya leo yako tayari.',
      );
      expect(celebrations.languages.last, 'sw');
    });
  });

  group('RepositoryCelebrations', () {
    late FakeApi api;
    late RepositoryCelebrations source;

    setUp(() {
      api = FakeApi();
      source = RepositoryCelebrations(
        LectioRepository(
          client: ApiClient(httpClient: api.client, baseUrl: FakeApi.baseUrl),
          cache: MemoryApiCache(),
          clock: () => DateTime(2026, 9, 20, 7),
        ),
      );
    });

    test('names the celebration in Kiswahili from the day document', () async {
      final day = fixtureObject('day');
      final celebrations = day['celebrations']! as List<Object?>;
      (celebrations.first! as Map<String, Object?>)['names'] = {
        'en': 'Twenty-fifth Sunday in Ordinary Time',
        'sw': 'Dominika ya 25 ya Mwaka',
      };
      api.serve('days/2026-09-20.json', jsonEncode(day));

      expect(
        await source.celebrationOn('2026-09-20', language: 'sw'),
        'Dominika ya 25 ya Mwaka',
      );
      expect(
        await source.celebrationOn('2026-09-20'),
        'Twenty-fifth Sunday in Ordinary Time',
      );
    });
  });
}
