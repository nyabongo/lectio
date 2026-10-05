import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lectio/features/settings/app_settings.dart';
import 'package:lectio/features/settings/key_value_store.dart';
import 'package:lectio/features/settings/settings_controller.dart';

void main() {
  group('SettingsController', () {
    test('starts with the defaults when nothing is saved', () {
      final controller = SettingsController(MemoryKeyValueStore());
      expect(controller.settings, const AppSettings());
    });

    test('starts with the saved settings', () {
      final store = MemoryKeyValueStore({
        SettingsController.storageKey: '{"version":1,"theme":"light"}',
      });
      final controller = SettingsController(store);
      expect(controller.settings.theme, ThemePreference.light);
    });

    test('ignores saved settings it cannot read', () {
      final store = MemoryKeyValueStore({
        SettingsController.storageKey: 'not json',
      });
      expect(SettingsController(store).settings, const AppSettings());
    });

    test('saves every change, and a new controller reads it back', () async {
      final store = MemoryKeyValueStore();
      final controller = SettingsController(store);
      var notified = 0;
      controller.addListener(() => notified++);

      const next = AppSettings(
        textSize: TextSize.large,
        playbackSpeed: 1.25,
        dailyReminder: true,
        reminderTime: TimeOfDay(hour: 6, minute: 45),
      );
      expect(await controller.update(next), isTrue);
      expect(controller.settings, next);
      expect(notified, 1);

      final saved = jsonDecode(store.read(SettingsController.storageKey)!);
      expect(saved, next.toJson());
      expect(SettingsController(store).settings, next);
    });

    test('does nothing when the settings are unchanged', () async {
      final store = MemoryKeyValueStore();
      final controller = SettingsController(store);
      var notified = 0;
      controller.addListener(() => notified++);

      expect(await controller.update(const AppSettings()), isTrue);
      expect(notified, 0);
      expect(store.values, isEmpty);
    });

    test('applies a change it could not save', () async {
      final store = MemoryKeyValueStore()..failWrites = true;
      final controller = SettingsController(store);
      const next = AppSettings(theme: ThemePreference.dark);

      expect(await controller.update(next), isFalse);
      expect(controller.settings, next);
      expect(store.values, isEmpty);
    });
  });

  group('text size', () {
    test('scales the device text scale', () {
      const data = MediaQueryData(textScaler: TextScaler.linear(1.5));
      final scaled = withTextSize(data, TextSize.large);
      expect(scaled.textScaler.scale(10), closeTo(10 * 1.5 * 1.125, 1e-9));
      final standard = withTextSize(data, TextSize.standard);
      expect(standard.textScaler.scale(10), closeTo(15, 1e-9));
    });

    test('standard keeps the device scaler itself', () {
      const data = MediaQueryData(textScaler: _AndroidNonLinear());
      expect(identical(withTextSize(data, TextSize.standard), data), isTrue);
    });

    test('composes with non-linear device scaling at 200%', () {
      const device = _AndroidNonLinear();
      const data = MediaQueryData(textScaler: device);
      final scaler = withTextSize(data, TextSize.larger).textScaler;

      // The reader's size enlarges the font, then the device's curve applies.
      expect(scaler.scale(14), closeTo(device.scale(14 * 1.25), 1e-9));
      expect(scaler.scale(28), closeTo(device.scale(28 * 1.25), 1e-9));
      // Large text keeps growing less than body text, as on Android 14+; a
      // single linear factor would scale both by the same amount.
      expect(scaler.scale(28) / 28, lessThan(scaler.scale(14) / 14));
      expect(scaler.scale(14), greaterThan(device.scale(14)));
      expect(scaler.scale(0), 0);
    });

    test('over a linear device scale it is the product', () {
      const TextScaler scaler = ReaderTextScaler(TextScaler.linear(2), 0.9);
      expect(scaler.scale(10), closeTo(18, 1e-9));
      // Older widgets still read the deprecated factor.
      // ignore: deprecated_member_use
      expect(scaler.textScaleFactor, closeTo(1.8, 1e-9));
    });

    test('is a value', () {
      const device = TextScaler.linear(2);
      const scaler = ReaderTextScaler(device, 1.25);
      expect(scaler, const ReaderTextScaler(TextScaler.linear(2), 1.25));
      expect(scaler.hashCode, const ReaderTextScaler(device, 1.25).hashCode);
      expect(scaler, isNot(const ReaderTextScaler(device, 0.9)));
      expect(scaler, isNot(const ReaderTextScaler(_AndroidNonLinear(), 1.25)));
      expect(scaler, isNot(device));
      expect(scaler.toString(), contains('1.25x'));
    });

    test('clamps like any scaler', () {
      const scaler = ReaderTextScaler(TextScaler.linear(2), 1.25);
      expect(scaler.clamp(maxScaleFactor: 2).scale(10), closeTo(20, 1e-9));
      expect(identical(scaler.clamp(), scaler), isTrue);
    });

    testWidgets('applyTextSize uses the scope settings', (tester) async {
      final controller = SettingsController(MemoryKeyValueStore());
      late TextScaler scaler;
      await tester.pumpWidget(
        SettingsScope(
          notifier: controller,
          child: MediaQuery(
            data: const MediaQueryData(),
            child: Builder(
              builder: (context) => applyTextSize(
                context,
                Builder(
                  builder: (context) {
                    scaler = MediaQuery.textScalerOf(context);
                    return const SizedBox();
                  },
                ),
              ),
            ),
          ),
        ),
      );
      expect(scaler.scale(10), closeTo(10, 1e-9));

      await controller.update(const AppSettings(textSize: TextSize.small));
      await tester.pump();
      expect(scaler.scale(10), closeTo(9, 1e-9));
    });

    testWidgets('applyTextSize copes without a child', (tester) async {
      await tester.pumpWidget(
        SettingsScope(
          notifier: SettingsController(MemoryKeyValueStore()),
          child: MediaQuery(
            data: const MediaQueryData(),
            child: Builder(builder: (context) => applyTextSize(context, null)),
          ),
        ),
      );
      expect(find.byType(SizedBox), findsOneWidget);
    });
  });

  testWidgets('SettingsScope.of needs a scope above', (tester) async {
    late BuildContext captured;
    await tester.pumpWidget(
      Builder(
        builder: (context) {
          captured = context;
          return const SizedBox();
        },
      ),
    );
    expect(() => SettingsScope.of(captured), throwsAssertionError);
  });
}

/// A device scaler shaped like Android 14's non-linear 200% font scale: body
/// text nearly doubles, larger text grows less, and 100sp text is not scaled.
class _AndroidNonLinear extends TextScaler {
  const new();

  @override
  double scale(double fontSize) {
    if (fontSize >= 100) return fontSize;
    return fontSize + fontSize * (1 - fontSize / 100);
  }

  @override
  double get textScaleFactor => scale(14) / 14;
}
