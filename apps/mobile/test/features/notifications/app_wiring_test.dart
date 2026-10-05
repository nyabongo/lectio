import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lectio/data/data.dart';
import 'package:lectio/features/notifications/daily_reminder_scheduler.dart';
import 'package:lectio/features/settings/key_value_store.dart';
import 'package:lectio/features/settings/settings_controller.dart';
import 'package:lectio/main.dart';
import 'package:lectio/src/app.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../data/fake_api.dart';
import 'fake_reminder_platform.dart';

void main() {
  late FakeApi api;

  setUp(() {
    api = FakeApi();
    appRepository = LectioRepository(
      client: ApiClient(httpClient: api.client, baseUrl: FakeApi.baseUrl),
      cache: MemoryApiCache(),
    );
  });

  tearDown(() => appRepository = null);

  testWidgets('the app starts the daily reminder at start-up', (tester) async {
    SharedPreferences.setMockInitialValues({
      SettingsController.storageKey: '{"version":1,"dailyReminder":true}',
    });
    final platform = FakeReminderPlatform();

    await runLectio(reminderPlatform: platform, links: const Stream.empty());
    await tester.pumpAndSettle();
    final app = tester.widget<LectioApp>(find.byType(LectioApp));
    await app.reminders!.idle;

    expect(platform.calls.first, 'initialize');
    // Already on: scheduled without asking for permission again.
    expect(platform.calls, isNot(contains('requestPermission')));
    expect(platform.pending, hasLength(reminderDays));
    expect(
      DailyReminderScope.maybeOf(tester.element(find.byType(Scaffold).first)),
      same(app.reminders),
    );
    app.reminders!.dispose();
  });

  testWidgets('a refused permission is explained in a snack bar', (
    tester,
  ) async {
    final settings = SettingsController(MemoryKeyValueStore());
    final platform = FakeReminderPlatform()..grantPermission = false;
    final reminders = DailyReminderScheduler(
      settings: settings,
      platform: platform,
      celebrations: FakeCelebrations(),
    );
    await reminders.start();
    await tester.pumpWidget(
      LectioApp(settings: settings, reminders: reminders),
    );
    await tester.pumpAndSettle();

    await settings.update(settings.settings.copyWith(dailyReminder: true));
    await reminders.idle;
    await tester.pump();

    expect(find.text(ReminderStrings.en.permissionRefused), findsOneWidget);
    expect(settings.settings.dailyReminder, isFalse);

    // Unmounting the app stops listening.
    await tester.pumpWidget(const SizedBox());
    reminders.dispose();
  });
}
