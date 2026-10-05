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
    return writeSafely(_store, storageKey, jsonEncode(settings.toJson()));
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

/// The device's own [TextScaler] with the reader's text-size [factor] on
/// top.
///
/// The factor enlarges the font size before the device scales it, so the
/// platform's own curve still applies: Android 14+ scales large text less
/// than body text (non-linear font scaling), and composing keeps that,
/// where multiplying one linear factor would flatten it. Over a linear
/// device scale it is the plain product of the two.
@immutable
class ReaderTextScaler extends TextScaler {
  /// Creates a scaler applying [factor], then [device].
  const new(this.device, this.factor) : assert(factor > 0, 'factor > 0');

  /// The device's text scaler (from its accessibility settings).
  final TextScaler device;

  /// The reader's text-size factor ([TextSize.scale]).
  final double factor;

  /// The font size [textScaleFactor] reports the scale at.
  static const double bodySize = 14;

  @override
  double scale(double fontSize) => device.scale(fontSize * factor);

  /// The scale at body-text size; prefer [scale].
  @override
  double get textScaleFactor => scale(bodySize) / bodySize;

  @override
  bool operator ==(Object other) {
    return other is ReaderTextScaler &&
        other.device == device &&
        other.factor == factor;
  }

  @override
  int get hashCode => Object.hash(device, factor);

  @override
  String toString() => '$device after reader ${factor}x';
}

/// [data] with [size] applied on top of the device's own text scale, through
/// a [ReaderTextScaler], so non-linear system scaling keeps its shape.
MediaQueryData withTextSize(MediaQueryData data, TextSize size) {
  if (size.scale == 1) return data;
  return data.copyWith(
    textScaler: ReaderTextScaler(data.textScaler, size.scale),
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
