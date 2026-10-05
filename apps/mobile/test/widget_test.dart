import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lectio/data/data.dart';
import 'package:lectio/features/today/today_screen.dart';
import 'package:lectio/main.dart' as app;
import 'package:lectio/src/app.dart';
import 'package:lectio/src/theme/liturgical_colour.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'data/fake_api.dart';

/// The header title [title], if shown.
Finder headerTitle(String title) =>
    find.descendant(of: find.byType(AppBar), matching: find.text(title));

/// The index of the selected bottom-bar tab.
int selectedTab(WidgetTester tester) =>
    tester.widget<NavigationBar>(find.byType(NavigationBar)).selectedIndex;

void main() {
  // Today reads a fake API that publishes no days, so tests stay offline.
  setUp(() {
    appRepository = LectioRepository(
      client: ApiClient(httpClient: FakeApi().client, baseUrl: FakeApi.baseUrl),
      cache: MemoryApiCache(),
    );
  });
  tearDown(() => appRepository = null);

  testWidgets('main() starts on Today', (tester) async {
    SharedPreferences.setMockInitialValues({});
    // The daily reminder (L-106) starts on the device's notifications plugin.
    const channel = MethodChannel('dexterous.com/flutter/local_notifications');
    AndroidFlutterLocalNotificationsPlugin.registerWith();
    tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
      channel,
      (call) async => call.method == 'initialize' ? true : null,
    );
    addTearDown(
      () => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
        channel,
        null,
      ),
    );
    await app.main();
    await tester.pumpAndSettle();

    expect(headerTitle('Today'), findsOneWidget);
    expect(find.byType(TodayScreen), findsOneWidget);
    expect(selectedTab(tester), 0);
  });

  testWidgets('/ redirects to Today', (tester) async {
    await tester.pumpWidget(const LectioApp(initialLocation: '/'));
    await tester.pumpAndSettle();

    expect(headerTitle('Today'), findsOneWidget);
  });

  testWidgets('the bottom bar switches between the tabs', (tester) async {
    await tester.pumpWidget(const LectioApp());
    await tester.pumpAndSettle();

    await tester.tap(find.byIcon(Icons.menu_book_outlined));
    await tester.pumpAndSettle();
    expect(headerTitle('Reading'), findsOneWidget);
    expect(selectedTab(tester), 1);

    await tester.tap(find.byIcon(Icons.headphones_outlined));
    await tester.pumpAndSettle();
    expect(headerTitle('Listen'), findsOneWidget);
    expect(selectedTab(tester), 2);

    await tester.tap(find.byIcon(Icons.today_outlined));
    await tester.pumpAndSettle();
    expect(headerTitle('Today'), findsOneWidget);
    expect(selectedTab(tester), 0);
  });

  testWidgets('a deep link opens its tab', (tester) async {
    await tester.pumpWidget(const LectioApp(initialLocation: '/listen'));
    await tester.pumpAndSettle();

    expect(headerTitle('Listen'), findsOneWidget);
    expect(selectedTab(tester), 2);
  });

  for (final title in ['Calendar', 'Settings']) {
    testWidgets('$title opens from the header and goes back', (tester) async {
      await tester.pumpWidget(const LectioApp());
      await tester.pumpAndSettle();

      await tester.tap(find.byTooltip(title));
      await tester.pumpAndSettle();
      expect(headerTitle(title), findsOneWidget);
      expect(find.byType(NavigationBar), findsNothing);

      await tester.tap(find.byType(BackButton));
      await tester.pumpAndSettle();
      expect(headerTitle('Today'), findsOneWidget);
    });
  }

  for (final location in ['/calendar', '/settings']) {
    testWidgets('a deep link to $location leads back to Today', (tester) async {
      await tester.pumpWidget(LectioApp(initialLocation: location));
      await tester.pumpAndSettle();
      expect(find.byType(BackButton), findsNothing);

      await tester.tap(find.byTooltip('Today'));
      await tester.pumpAndSettle();
      expect(headerTitle('Today'), findsOneWidget);
    });
  }

  testWidgets('an unknown location shows not found', (tester) async {
    await tester.pumpWidget(const LectioApp(initialLocation: '/nowhere'));
    await tester.pumpAndSettle();
    expect(headerTitle('Not found'), findsOneWidget);

    await tester.tap(find.text('Go to Today'));
    await tester.pumpAndSettle();
    expect(headerTitle('Today'), findsOneWidget);
  });

  testWidgets('the liturgical colour tints the accent', (tester) async {
    await tester.pumpWidget(const LectioApp(colour: LiturgicalColour.violet));
    await tester.pumpAndSettle();

    final context = tester.element(find.byType(NavigationBar));
    final scheme = Theme.of(context).colorScheme;
    expect(scheme.primary, LiturgicalColour.violet.light);
    expect(scheme.onPrimary, const Color(0xFFFFFFFF));
  });
}
