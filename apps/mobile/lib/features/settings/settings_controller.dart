import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:lectio/features/settings/app_settings.dart';
import 'package:lectio/features/settings/key_value_store.dart';

/// Holds the reader's [AppSettings] and saves every change to a
/// [KeyValueStore].
///
/// Other features read it with `SettingsScope.of(context).settings` and
/// rebuild when it changes: Listen (L-104) starts at
/// [AppSettings.playbackSpeed], the daily notification (L-106) listens for
/// [AppSettings.dailyReminder] and [AppSettings.reminderTime], and L-114
/// switches the UI to [AppSettings.language].
class SettingsController extends ChangeNotifier {
  /// Creates a controller reading and saving settings in [_store].
  new(this._store);

  /// The key the settings are saved under.
  static const String storageKey = 'lectio.settings';

  final KeyValueStore _store;

  late AppSettings _settings = AppSettings.parse(_store.read(storageKey));

  /// The current settings.
  AppSettings get settings => _settings;

  /// Applies [settings] at once and saves them; completes with whether the
  /// save stuck (the new settings apply either way, until the app stops).
  Future<bool> update(AppSettings settings) {
    if (settings == _settings) return Future.value(true);
    _settings = settings;
    notifyListeners();
    return _store.write(storageKey, jsonEncode(settings.toJson()));
  }
}

/// Makes a [SettingsController] available below it, rebuilding dependants
/// when the settings change.
class SettingsScope extends InheritedNotifier<SettingsController> {
  /// Provides [notifier] to [child].
  const new({
    required SettingsController super.notifier,
    required super.child,
    super.key,
  });

  /// The controller of the nearest [SettingsScope]; [context] rebuilds when
  /// the settings change.
  static SettingsController of(BuildContext context) {
    final scope = context.dependOnInheritedWidgetOfExactType<SettingsScope>();
    assert(scope != null, 'No SettingsScope above this context');
    return scope!.notifier!;
  }
}

/// [data] with [size] applied on top of the device's own text scale.
MediaQueryData withTextSize(MediaQueryData data, TextSize size) {
  // The device's factor at a body-text size, so non-linear system scaling
  // (Android 14+) keeps its proportion.
  const bodySize = 14.0;
  final deviceFactor = data.textScaler.scale(bodySize) / bodySize;
  return data.copyWith(
    textScaler: TextScaler.linear(deviceFactor * size.scale),
  );
}

/// Applies the text size from the nearest [SettingsScope] to [child]; use it
/// as `MaterialApp.builder`.
Widget applyTextSize(BuildContext context, Widget? child) {
  final size = SettingsScope.of(context).settings.textSize;
  return MediaQuery(
    data: withTextSize(MediaQuery.of(context), size),
    child: child ?? const SizedBox.shrink(),
  );
}
