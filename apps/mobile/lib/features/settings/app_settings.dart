import 'dart:convert';

import 'package:flutter/material.dart';

/// Text sizes and their scale on top of the device's own text size.
///
/// The same steps as the site's Settings page (`TEXT_SIZES` in
/// `apps/web/src/lib/settings.ts`).
enum TextSize {
  /// 90%.
  small(0.9, 'Small'),

  /// The device's own size.
  standard(1, 'Standard'),

  /// 112.5%.
  large(1.125, 'Large'),

  /// 125%.
  larger(1.25, 'Larger');

  new(this.scale, this.label);

  /// The factor applied to the device's text scale.
  final double scale;

  /// The label shown in Settings.
  final String label;
}

/// The colour theme: the device's choice, or always light or dark.
enum ThemePreference {
  /// Follow the device's light or dark setting.
  system('System'),

  /// Always light.
  light('Light'),

  /// Always dark.
  dark('Dark');

  new(this.label);

  /// The label shown in Settings.
  final String label;

  /// This preference as a [ThemeMode] for `MaterialApp.themeMode`.
  ThemeMode get mode => switch (this) {
    ThemePreference.system => ThemeMode.system,
    ThemePreference.light => ThemeMode.light,
    ThemePreference.dark => ThemeMode.dark,
  };
}

/// UI languages. A language that is not [available] yet is listed as coming
/// soon and cannot be chosen (L-114 adds Kiswahili).
enum AppLanguage {
  /// English.
  en('English', available: true),

  /// Kiswahili.
  sw('Kiswahili', available: false);

  new(this.label, {required this.available});

  /// The language's own name.
  final String label;

  /// Whether the language can be chosen.
  final bool available;

  /// The language as a [Locale].
  Locale get locale => Locale(name);
}

/// The playback speeds the Listen queue offers, as on the site.
const List<double> playbackSpeeds = [0.75, 1, 1.25, 1.5, 1.75, 2];

/// [speed] as a label, for example `1.25×` or `2×`.
String speedLabel(double speed) {
  final text = speed == speed.roundToDouble()
      ? speed.round().toString()
      : speed.toString();
  return '$text×';
}

final RegExp _clockTime = RegExp(r'^(\d{2}):(\d{2})$');

/// [time] as `HH:mm`, the stored form.
String formatClockTime(TimeOfDay time) {
  String two(int value) => value.toString().padLeft(2, '0');
  return '${two(time.hour)}:${two(time.minute)}';
}

/// The `HH:mm` [value] as a time of day, or `null` when it is not one.
TimeOfDay? parseClockTime(Object? value) {
  final match = value is String ? _clockTime.firstMatch(value) : null;
  if (match == null) return null;
  final hour = int.parse(match.group(1)!);
  final minute = int.parse(match.group(2)!);
  if (hour > 23 || minute > 59) return null;
  return TimeOfDay(hour: hour, minute: minute);
}

T _byName<T extends Enum>(List<T> values, Object? name, T fallback) {
  for (final value in values) {
    if (value.name == name) return value;
  }
  return fallback;
}

/// The reader's preferences, kept on the device.
///
/// Stored as versioned JSON. Reading is tolerant, as on the site: version 1
/// is the only shape so far, and a record with another `version` (or none)
/// is read field by field, so whatever is still valid survives. Malformed
/// JSON or a field with the wrong type falls back to the default, so a bad
/// value never stops the app from starting. Settings are cheap to set again,
/// so unlike bookmarks and notes they are not backed up before an overwrite.
@immutable
class AppSettings {
  /// Creates settings; every field has a default.
  const new({
    this.textSize = TextSize.standard,
    this.theme = ThemePreference.system,
    this.playbackSpeed = 1,
    this.language = AppLanguage.en,
    this.dailyReminder = false,
    this.reminderTime = const TimeOfDay(hour: 7, minute: 0),
  });

  /// Reads settings written by [toJson], keeping the valid fields of [json]
  /// and the defaults for the rest.
  factory fromJson(Object? json) {
    const defaults = AppSettings();
    if (json is! Map<String, Object?>) return defaults;
    final speed = json['playbackSpeed'];
    final language = _byName(
      AppLanguage.values,
      json['language'],
      defaults.language,
    );
    final reminder = json['dailyReminder'];
    return AppSettings(
      textSize: _byName(TextSize.values, json['textSize'], defaults.textSize),
      theme: _byName(ThemePreference.values, json['theme'], defaults.theme),
      playbackSpeed: speed is num && playbackSpeeds.contains(speed.toDouble())
          ? speed.toDouble()
          : defaults.playbackSpeed,
      language: language.available ? language : defaults.language,
      dailyReminder: reminder is bool ? reminder : defaults.dailyReminder,
      reminderTime:
          parseClockTime(json['reminderTime']) ?? defaults.reminderTime,
    );
  }

  /// Reads the stored JSON text [raw]; the defaults when it is missing or
  /// not JSON.
  factory parse(String? raw) {
    if (raw == null) return const AppSettings();
    try {
      return AppSettings.fromJson(jsonDecode(raw));
    } on FormatException {
      return const AppSettings();
    }
  }

  /// The shape version written with every save. Bump it, and migrate in
  /// [AppSettings.fromJson], when the shape changes.
  static const int version = 1;

  /// How large text is, on top of the device's text size.
  final TextSize textSize;

  /// Light, dark or the device's choice.
  final ThemePreference theme;

  /// Where the Listen queue starts (one of [playbackSpeeds]).
  final double playbackSpeed;

  /// The UI language.
  final AppLanguage language;

  /// Whether the daily notification is on (scheduled by L-106).
  final bool dailyReminder;

  /// When the daily notification arrives, in local time.
  final TimeOfDay reminderTime;

  /// A copy with the given fields replaced.
  AppSettings copyWith({
    TextSize? textSize,
    ThemePreference? theme,
    double? playbackSpeed,
    AppLanguage? language,
    bool? dailyReminder,
    TimeOfDay? reminderTime,
  }) {
    return AppSettings(
      textSize: textSize ?? this.textSize,
      theme: theme ?? this.theme,
      playbackSpeed: playbackSpeed ?? this.playbackSpeed,
      language: language ?? this.language,
      dailyReminder: dailyReminder ?? this.dailyReminder,
      reminderTime: reminderTime ?? this.reminderTime,
    );
  }

  /// The settings as JSON, for [AppSettings.fromJson].
  Map<String, Object?> toJson() => {
    'version': version,
    'textSize': textSize.name,
    'theme': theme.name,
    'playbackSpeed': playbackSpeed,
    'language': language.name,
    'dailyReminder': dailyReminder,
    'reminderTime': formatClockTime(reminderTime),
  };

  @override
  bool operator ==(Object other) {
    return other is AppSettings &&
        other.textSize == textSize &&
        other.theme == theme &&
        other.playbackSpeed == playbackSpeed &&
        other.language == language &&
        other.dailyReminder == dailyReminder &&
        other.reminderTime == reminderTime;
  }

  @override
  int get hashCode => Object.hash(
    textSize,
    theme,
    playbackSpeed,
    language,
    dailyReminder,
    reminderTime,
  );
}
