import 'package:shared_preferences/shared_preferences.dart';

/// String storage on the device, keyed by name.
///
/// Settings, bookmarks and personal notes are kept through this interface:
/// [SharedPreferencesStore] in the app, [MemoryKeyValueStore] in tests. There
/// are no accounts, so nothing here ever leaves the device.
abstract interface class KeyValueStore {
  /// The string saved under [key], or `null` when there is none.
  String? read(String key);

  /// Saves [value] under [key]; whether the write stuck.
  Future<bool> write(String key, String value);
}

/// A [KeyValueStore] in memory, lost when the app stops.
class MemoryKeyValueStore implements KeyValueStore {
  /// Creates a store holding a copy of [values].
  new([Map<String, String> values = const {}]) : _values = {...values};

  final Map<String, String> _values;

  /// Whether the next writes fail, like a full disk.
  bool failWrites = false;

  /// Everything saved so far.
  Map<String, String> get values => Map.unmodifiable(_values);

  @override
  String? read(String key) => _values[key];

  @override
  Future<bool> write(String key, String value) async {
    if (failWrites) return false;
    _values[key] = value;
    return true;
  }
}

/// A [KeyValueStore] on the platform's preferences (`SharedPreferences` on
/// Android, `NSUserDefaults` on iOS), cached in memory once loaded.
class SharedPreferencesStore implements KeyValueStore {
  /// Creates a store over the loaded preferences.
  new(this._preferences);

  final SharedPreferences _preferences;

  /// Loads the device's preferences.
  static Future<SharedPreferencesStore> open() async {
    return SharedPreferencesStore(await SharedPreferences.getInstance());
  }

  @override
  String? read(String key) {
    final value = _preferences.get(key);
    return value is String ? value : null;
  }

  @override
  Future<bool> write(String key, String value) {
    return _preferences.setString(key, value);
  }
}

/// Writes [value] under [key] in [store]; `false` when the write fails or
/// throws (a platform channel error, for example), never an exception.
Future<bool> writeSafely(KeyValueStore store, String key, String value) async {
  try {
    return await store.write(key, value);
  } on Exception {
    return false;
  }
}

/// The device's store from [open] (default: [SharedPreferencesStore.open]).
///
/// Settings, bookmarks and notes are optional, so they never stop the app
/// from starting: when the preferences cannot be opened this falls back to a
/// store in memory whose writes report failure, so every change still
/// applies and the reader is told it will not be kept.
Future<KeyValueStore> openDeviceStore({
  Future<KeyValueStore> Function()? open,
}) async {
  try {
    return await (open ?? SharedPreferencesStore.open)();
  } on Object {
    return MemoryKeyValueStore()..failWrites = true;
  }
}
