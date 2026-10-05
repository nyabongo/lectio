import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lectio/src/app.dart';

import 'lectio_harness.dart';

/// Golden images of the main screens in light and dark, on a phone and a
/// tablet (L-108).
///
/// The references in `screens/` are drawn by CI on Linux with the pinned
/// Flutter and the SDK's Roboto, at a device pixel ratio of 1. Nobody draws
/// them locally: run the Flutter workflow by hand with `update_goldens`, then
/// commit the `flutter-goldens` artifact into `screens/`. A failing compare
/// uploads the diffs as `flutter-golden-failures`.
void main() {
  setUpAll(loadGoldenFonts);
  // No DEBUG ribbon over the app bar actions.
  setUp(() => WidgetsApp.debugAllowBannerOverride = false);
  tearDown(() => WidgetsApp.debugAllowBannerOverride = true);

  const screens = [Screen.today, Screen.reading, Screen.settings];
  for (final screen in screens) {
    for (final brightness in Brightness.values) {
      for (final device in Device.values) {
        final name = '${screen.name}_${brightness.name}_${device.name}';
        testWidgets('$name matches its golden', (tester) async {
          useSize(tester, device.size);
          serveSeedDay();
          await pumpScreen(tester, screen, brightness: brightness);

          await expectLater(
            find.byType(LectioApp),
            matchesGoldenFile('screens/$name.png'),
          );
        });
      }
    }
  }

  testWidgets('today at 200% text matches its golden', (tester) async {
    useSize(tester, Device.phone.size);
    useDeviceTextScale(tester, 2);
    serveSeedDay();
    await pumpScreen(tester, Screen.today);

    await expectLater(
      find.byType(LectioApp),
      matchesGoldenFile('screens/today_light_phone_200.png'),
    );
  });
}
