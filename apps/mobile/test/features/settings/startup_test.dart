import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lectio/features/bookmarks/bookmarks_controller.dart';
import 'package:lectio/features/settings/app_settings.dart';
import 'package:lectio/features/settings/key_value_store.dart';
import 'package:lectio/features/settings/settings_controller.dart';
import 'package:lectio/src/app.dart';

void main() {
  testWidgets('the app starts on Today when the preferences fail to open', (
    tester,
  ) async {
    final store = await openDeviceStore(
      open: () async => throw PlatformException(code: 'channel-error'),
    );
    final settings = SettingsController(store);
    await tester.pumpWidget(
      LectioApp(settings: settings, bookmarks: BookmarksController(store)),
    );
    await tester.pumpAndSettle();

    expect(
      find.descendant(of: find.byType(AppBar), matching: find.text('Today')),
      findsOneWidget,
    );

    // Changes still apply for this session; they just are not kept.
    expect(
      await settings.update(const AppSettings(theme: ThemePreference.dark)),
      isFalse,
    );
    await tester.pumpAndSettle();
    final app = tester.widget<MaterialApp>(find.byType(MaterialApp));
    expect(app.themeMode, ThemeMode.dark);
  });
}
