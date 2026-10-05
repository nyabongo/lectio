import 'package:flutter/widgets.dart';
import 'package:lectio/features/bookmarks/bookmarks_controller.dart';
import 'package:lectio/features/settings/key_value_store.dart';
import 'package:lectio/features/settings/settings_controller.dart';
import 'package:lectio/src/app.dart';

/// Starts the app with settings, bookmarks and notes saved on the device.
Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final store = await SharedPreferencesStore.open();
  runApp(
    LectioApp(
      settings: SettingsController(store),
      bookmarks: BookmarksController(store),
    ),
  );
}
