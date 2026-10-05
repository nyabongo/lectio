import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lectio/features/settings/app_settings.dart';

void main() {
  const custom = AppSettings(
    textSize: TextSize.larger,
    theme: ThemePreference.dark,
    playbackSpeed: 1.5,
    dailyReminder: true,
    reminderTime: TimeOfDay(hour: 21, minute: 5),
  );

  group('AppSettings', () {
    test('defaults match the site', () {
      const settings = AppSettings();
      expect(settings.textSize, TextSize.standard);
      expect(settings.theme, ThemePreference.system);
      expect(settings.playbackSpeed, 1);
      expect(settings.language, AppLanguage.en);
      expect(settings.dailyReminder, isFalse);
      expect(settings.reminderTime, const TimeOfDay(hour: 7, minute: 0));
    });

    test('round-trips through JSON', () {
      final json = custom.toJson();
      expect(json, {
        'version': 1,
        'textSize': 'larger',
        'theme': 'dark',
        'playbackSpeed': 1.5,
        'language': 'en',
        'dailyReminder': true,
        'reminderTime': '21:05',
      });
      expect(AppSettings.fromJson(json), custom);
      expect(AppSettings.parse(jsonEncode(json)), custom);
    });

    test('falls back to the default field by field', () {
      final settings = AppSettings.fromJson(const {
        'textSize': 'huge',
        'theme': 'dark',
        'playbackSpeed': 3,
        'language': 'fr',
        'dailyReminder': 'yes',
        'reminderTime': '25:00',
      });
      expect(settings, const AppSettings(theme: ThemePreference.dark));
    });

    test('accepts an integer speed from JSON', () {
      expect(
        AppSettings.fromJson(const {'playbackSpeed': 2}).playbackSpeed,
        2.0,
      );
    });

    test('reads Kiswahili', () {
      expect(
        AppSettings.fromJson(const {'language': 'sw'}).language,
        AppLanguage.sw,
      );
    });

    test('reads anything that is not an object as the defaults', () {
      expect(AppSettings.fromJson(null), const AppSettings());
      expect(AppSettings.fromJson(const [1, 2]), const AppSettings());
      expect(AppSettings.parse(null), const AppSettings());
      expect(AppSettings.parse(''), const AppSettings());
      expect(AppSettings.parse('{not json'), const AppSettings());
      expect(AppSettings.parse('"text"'), const AppSettings());
    });

    test('copyWith replaces only the given fields', () {
      const settings = AppSettings();
      expect(settings.copyWith(), settings);
      final changed = settings.copyWith(
        textSize: TextSize.small,
        theme: ThemePreference.light,
        playbackSpeed: 0.75,
        language: AppLanguage.en,
        dailyReminder: true,
        reminderTime: const TimeOfDay(hour: 6, minute: 30),
      );
      expect(changed.textSize, TextSize.small);
      expect(changed.theme, ThemePreference.light);
      expect(changed.playbackSpeed, 0.75);
      expect(changed.dailyReminder, isTrue);
      expect(changed.reminderTime, const TimeOfDay(hour: 6, minute: 30));
    });

    test('compares by value', () {
      expect(custom, AppSettings.fromJson(custom.toJson()));
      expect(custom.hashCode, AppSettings.fromJson(custom.toJson()).hashCode);
      expect(custom, isNot(const AppSettings()));
      expect(custom == Object(), isFalse);
    });
  });

  group('options', () {
    test('text sizes scale like the site', () {
      expect(
        [for (final size in TextSize.values) size.scale],
        [0.9, 1, 1.125, 1.25],
      );
      expect(TextSize.standard.labelKey, 'settings_textSize_default');
    });

    test('theme preferences map to theme modes', () {
      expect(ThemePreference.system.mode, ThemeMode.system);
      expect(ThemePreference.light.mode, ThemeMode.light);
      expect(ThemePreference.dark.mode, ThemeMode.dark);
      expect(ThemePreference.dark.labelKey, 'settings_theme_dark');
    });

    test('languages have locales and their own names', () {
      expect(AppLanguage.en.locale, const Locale('en'));
      expect(AppLanguage.sw.locale, const Locale('sw'));
      expect(AppLanguage.en.label, 'English');
      expect(AppLanguage.sw.label, 'Kiswahili');
    });

    test('speed labels drop a trailing .0', () {
      expect(playbackSpeeds.map(speedLabel), [
        '0.75×',
        '1×',
        '1.25×',
        '1.5×',
        '1.75×',
        '2×',
      ]);
    });
  });

  group('clock times', () {
    test('format with two digits', () {
      expect(formatClockTime(const TimeOfDay(hour: 7, minute: 5)), '07:05');
      expect(formatClockTime(const TimeOfDay(hour: 23, minute: 59)), '23:59');
    });

    test('parse HH:mm only', () {
      expect(parseClockTime('00:00'), const TimeOfDay(hour: 0, minute: 0));
      expect(parseClockTime('23:59'), const TimeOfDay(hour: 23, minute: 59));
      expect(parseClockTime('24:00'), isNull);
      expect(parseClockTime('12:60'), isNull);
      expect(parseClockTime('7:00'), isNull);
      expect(parseClockTime(700), isNull);
      expect(parseClockTime(null), isNull);
    });
  });
}
