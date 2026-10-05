import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:lectio/features/bookmarks/bookmarks_controller.dart';
import 'package:lectio/features/settings/key_value_store.dart';
import 'package:lectio/features/settings/settings_controller.dart';
import 'package:lectio/src/routing/router.dart';
import 'package:lectio/src/theme/lectio_theme.dart';
import 'package:lectio/src/theme/liturgical_colour.dart';

/// The Lectio app: Material 3, tinted by the day's liturgical colour.
class LectioApp extends StatefulWidget {
  /// Creates the app with the accent for [colour], starting at
  /// [initialLocation]. [settings] and [bookmarks] default to controllers in
  /// memory; `main` passes ones saved on the device.
  const new({
    super.key,
    this.colour = LiturgicalColour.green,
    this.initialLocation = '/today',
    this.settings,
    this.bookmarks,
  });

  /// The liturgical colour that tints the accent.
  final LiturgicalColour colour;

  /// Where the router starts.
  final String initialLocation;

  /// The reader's settings, which set the theme and text size.
  final SettingsController? settings;

  /// Bookmarks and personal notes.
  final BookmarksController? bookmarks;

  @override
  State<LectioApp> createState() => _LectioAppState();
}

class _LectioAppState extends State<LectioApp> {
  late final GoRouter _router = createRouter(
    initialLocation: widget.initialLocation,
  );

  late final SettingsController _settings =
      widget.settings ?? SettingsController(MemoryKeyValueStore());

  late final BookmarksController _bookmarks =
      widget.bookmarks ?? BookmarksController(MemoryKeyValueStore());

  @override
  void dispose() {
    _router.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return SettingsScope(
      notifier: _settings,
      child: BookmarksScope(
        notifier: _bookmarks,
        child: ListenableBuilder(
          listenable: _settings,
          builder: (context, _) => MaterialApp.router(
            title: 'Lectio',
            theme: buildLectioTheme(widget.colour, Brightness.light),
            darkTheme: buildLectioTheme(widget.colour, Brightness.dark),
            themeMode: _settings.settings.theme.mode,
            builder: applyTextSize,
            routerConfig: _router,
          ),
        ),
      ),
    );
  }
}
