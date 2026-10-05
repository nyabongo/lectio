import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:lectio/data/api_cache.dart';
import 'package:lectio/data/api_client.dart';
import 'package:lectio/data/app_repository.dart';
import 'package:lectio/data/repository.dart';
import 'package:lectio/features/bookmarks/bookmarks_controller.dart';
import 'package:lectio/features/bookmarks/bookmarks_screen.dart';
import 'package:lectio/features/settings/app_settings.dart';
import 'package:lectio/features/settings/key_value_store.dart';
import 'package:lectio/features/settings/settings_controller.dart';
import 'package:lectio/features/settings/settings_screen.dart';
import 'package:lectio/src/app.dart';

import '../../data/fake_api.dart';

/// Makes the test window tall enough to show every setting.
void useTallView(WidgetTester tester) {
  tester.view
    ..physicalSize = const Size(800, 2000)
    ..devicePixelRatio = 1;
  addTearDown(tester.view.reset);
}

/// Shows Settings in the whole app, with settings kept in [store].
Future<SettingsController> pumpApp(
  WidgetTester tester,
  MemoryKeyValueStore store,
) async {
  useTallView(tester);
  final controller = SettingsController(store);
  await tester.pumpWidget(
    LectioApp(initialLocation: '/settings', settings: controller),
  );
  await tester.pumpAndSettle();
  return controller;
}

/// Shows only Settings, asking for times with [pickTime].
Future<SettingsController> pumpScreen(
  WidgetTester tester, {
  required TimePicker pickTime,
  AppSettings settings = const AppSettings(),
}) async {
  useTallView(tester);
  final store = MemoryKeyValueStore({
    SettingsController.storageKey: jsonEncode(settings.toJson()),
  });
  final controller = SettingsController(store);
  final router = GoRouter(
    initialLocation: '/settings',
    routes: [
      GoRoute(
        path: '/settings',
        builder: (context, state) => SettingsScreen(pickTime: pickTime),
      ),
    ],
  );
  addTearDown(router.dispose);
  await tester.pumpWidget(
    SettingsScope(
      notifier: controller,
      child: MaterialApp.router(routerConfig: router),
    ),
  );
  await tester.pumpAndSettle();
  return controller;
}

/// The saved settings in [store].
AppSettings saved(MemoryKeyValueStore store) {
  return AppSettings.parse(store.read(SettingsController.storageKey));
}

void main() {
  // Today, shown when the app starts, reads an offline fake API.
  setUp(() {
    appRepository = LectioRepository(
      client: ApiClient(httpClient: FakeApi().client, baseUrl: FakeApi.baseUrl),
      cache: MemoryApiCache(),
    );
  });
  tearDown(() => appRepository = null);

  late MemoryKeyValueStore store;

  setUp(() => store = MemoryKeyValueStore());

  testWidgets('shows every setting with its current value', (tester) async {
    await pumpApp(tester, store);

    expect(find.text('Text size'), findsOneWidget);
    expect(find.text('Theme'), findsOneWidget);
    expect(find.text('Default playback speed'), findsOneWidget);
    expect(find.text('Language'), findsOneWidget);
    expect(find.text('Remind me each day'), findsOneWidget);
    expect(find.text('7:00 AM'), findsOneWidget);
    expect(find.text(bookmarksTitle), findsOneWidget);
  });

  testWidgets('text size applies at once and is saved', (tester) async {
    final controller = await pumpApp(tester, store);

    await tester.tap(find.text('Larger'));
    await tester.pumpAndSettle();

    expect(controller.settings.textSize, TextSize.larger);
    expect(saved(store).textSize, TextSize.larger);
    final context = tester.element(find.text('Theme'));
    expect(MediaQuery.textScalerOf(context).scale(10), closeTo(12.5, 1e-9));
  });

  testWidgets('theme applies at once and is saved', (tester) async {
    await pumpApp(tester, store);

    await tester.tap(find.text('Dark'));
    await tester.pumpAndSettle();

    expect(saved(store).theme, ThemePreference.dark);
    final app = tester.widget<MaterialApp>(find.byType(MaterialApp));
    expect(app.themeMode, ThemeMode.dark);
    final context = tester.element(find.text('Theme'));
    expect(Theme.of(context).brightness, Brightness.dark);
  });

  testWidgets('playback speed is saved', (tester) async {
    final controller = await pumpApp(tester, store);

    await tester.tap(find.text('1.5×'));
    await tester.pumpAndSettle();

    expect(controller.settings.playbackSpeed, 1.5);
    expect(saved(store).playbackSpeed, 1.5);
    final chip = tester.widget<ChoiceChip>(
      find.widgetWithText(ChoiceChip, '1.5×'),
    );
    expect(chip.selected, isTrue);
  });

  testWidgets('Kiswahili is listed as coming soon', (tester) async {
    final controller = await pumpApp(tester, store);

    expect(find.text('Coming soon'), findsOneWidget);
    await tester.tap(find.text('Kiswahili'));
    await tester.pumpAndSettle();

    expect(controller.settings.language, AppLanguage.en);
    expect(store.values, isEmpty);
  });

  testWidgets('choosing English keeps the other settings', (tester) async {
    final controller = await pumpApp(tester, store);
    await controller.update(const AppSettings(theme: ThemePreference.light));
    await tester.pumpAndSettle();

    await tester.tap(find.text('English'));
    await tester.pumpAndSettle();

    expect(controller.settings.language, AppLanguage.en);
    expect(controller.settings.theme, ThemePreference.light);
  });

  testWidgets('the daily reminder turns on and keeps its time', (tester) async {
    final controller = await pumpApp(tester, store);
    final timeTile = find.widgetWithText(ListTile, 'Reminder time');
    expect(tester.widget<ListTile>(timeTile).enabled, isFalse);

    await tester.tap(find.text('Remind me each day'));
    await tester.pumpAndSettle();

    expect(controller.settings.dailyReminder, isTrue);
    expect(saved(store).dailyReminder, isTrue);
    expect(tester.widget<ListTile>(timeTile).enabled, isTrue);
  });

  testWidgets('the Material time picker sets the reminder time', (
    tester,
  ) async {
    final controller = await pumpApp(tester, store);
    await controller.update(const AppSettings(dailyReminder: true));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Reminder time'));
    await tester.pumpAndSettle();
    expect(find.byType(TimePickerDialog), findsOneWidget);

    await tester.tap(find.text('OK'));
    await tester.pumpAndSettle();
    expect(find.byType(TimePickerDialog), findsNothing);
    expect(
      controller.settings.reminderTime,
      const TimeOfDay(hour: 7, minute: 0),
    );
  });

  testWidgets('a picked time is saved', (tester) async {
    final asked = <TimeOfDay>[];
    final controller = await pumpScreen(
      tester,
      settings: const AppSettings(dailyReminder: true),
      pickTime: (context, initial) async {
        asked.add(initial);
        return const TimeOfDay(hour: 21, minute: 30);
      },
    );

    await tester.tap(find.text('Reminder time'));
    await tester.pumpAndSettle();

    expect(asked, [const TimeOfDay(hour: 7, minute: 0)]);
    expect(
      controller.settings.reminderTime,
      const TimeOfDay(hour: 21, minute: 30),
    );
    expect(find.text('9:30 PM'), findsOneWidget);
  });

  testWidgets('a cancelled time changes nothing', (tester) async {
    final controller = await pumpScreen(
      tester,
      settings: const AppSettings(dailyReminder: true),
      pickTime: (context, initial) async => null,
    );

    await tester.tap(find.text('Reminder time'));
    await tester.pumpAndSettle();

    expect(controller.settings, const AppSettings(dailyReminder: true));
  });

  testWidgets('says so when the device does not save', (tester) async {
    store.failWrites = true;
    final controller = await pumpApp(tester, store);

    await tester.tap(find.text('Large'));
    await tester.pumpAndSettle();

    expect(controller.settings.textSize, TextSize.large);
    expect(find.textContaining('not letting Lectio save'), findsOneWidget);
  });

  testWidgets('fits a 360dp phone at the largest text', (tester) async {
    tester.view
      ..physicalSize = const Size(360, 800)
      ..devicePixelRatio = 1;
    tester.platformDispatcher.textScaleFactorTestValue = 2;
    addTearDown(tester.view.reset);
    addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
    final device = MemoryKeyValueStore({
      SettingsController.storageKey: jsonEncode(
        const AppSettings(textSize: TextSize.larger).toJson(),
      ),
    });
    await tester.pumpWidget(
      LectioApp(
        initialLocation: '/settings',
        settings: SettingsController(device),
      ),
    );
    await tester.pumpAndSettle();

    final context = tester.element(find.text('Text size'));
    expect(MediaQuery.textScalerOf(context).scale(10), closeTo(25, 1e-9));
    // A RenderFlex overflow anywhere on the way down fails the test.
    await tester.scrollUntilVisible(find.text(bookmarksTitle), 200);
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
  });

  testWidgets('opens bookmarks and notes', (tester) async {
    await pumpApp(tester, store);

    await tester.tap(find.text(bookmarksTitle));
    await tester.pumpAndSettle();

    expect(find.byType(BookmarksScreen), findsOneWidget);
    expect(find.text('No bookmarks yet.'), findsOneWidget);

    await tester.tap(find.byType(BackButton));
    await tester.pumpAndSettle();
    expect(find.text('Text size'), findsOneWidget);
  });

  testWidgets('the app starts with saved settings', (tester) async {
    final device = MemoryKeyValueStore({
      SettingsController.storageKey: jsonEncode(
        const AppSettings(theme: ThemePreference.dark).toJson(),
      ),
    });
    await tester.pumpWidget(
      LectioApp(
        settings: SettingsController(device),
        bookmarks: BookmarksController(device),
      ),
    );
    await tester.pumpAndSettle();

    final app = tester.widget<MaterialApp>(find.byType(MaterialApp));
    expect(app.themeMode, ThemeMode.dark);
  });
}
