import 'dart:async';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:lectio/features/bookmarks/bookmarks_controller.dart';
import 'package:lectio/features/notifications/daily_reminder_scheduler.dart';
import 'package:lectio/features/settings/key_value_store.dart';
import 'package:lectio/features/settings/settings_controller.dart';
import 'package:lectio/l10n/lectio_localizations.dart';
import 'package:lectio/features/share/deep_links.dart';
import 'package:lectio/features/share/share_button.dart';
import 'package:lectio/src/routing/router.dart';
import 'package:lectio/src/theme/lectio_theme.dart';
import 'package:lectio/src/theme/liturgical_colour.dart';

/// The Lectio app: Material 3, tinted by the day's liturgical colour, in the
/// language chosen in Settings (English or Kiswahili, L-114).
class LectioApp extends StatefulWidget {
  /// Creates the app with the accent for [colour], starting at
  /// [initialLocation]. [settings] and [bookmarks] default to controllers in
  /// memory; `main` passes ones saved on the device, the daily
  /// [reminders] that follow [settings], and the incoming [links].
  const new({
    super.key,
    this.colour = LiturgicalColour.green,
    this.initialLocation = '/today',
    this.settings,
    this.bookmarks,
    this.reminders,
    this.links,
  });

  /// The liturgical colour that tints the accent.
  final LiturgicalColour colour;

  /// Where the router starts.
  final String initialLocation;

  /// The reader's settings, which set the theme and text size.
  final SettingsController? settings;

  /// Bookmarks and personal notes.
  final BookmarksController? bookmarks;

  /// The daily reminder, shared with the screens below through
  /// [DailyReminderScope]; when it switches itself off because notifications
  /// are not allowed, the app says why in a snack bar.
  final DailyReminderScheduler? reminders;

  /// Site links and reminder taps (L-107): the app starts at the one that
  /// launched it, instead of [initialLocation], and opens later ones.
  final DeepLinks? links;

  @override
  State<LectioApp> createState() => _LectioAppState();
}

class _LectioAppState extends State<LectioApp> {
  late final GoRouter _router = createRouter(
    initialLocation:
        widget.links?.takeInitialLocation() ?? widget.initialLocation,
  );

  late final SettingsController _settings =
      widget.settings ?? SettingsController(MemoryKeyValueStore());

  late final BookmarksController _bookmarks =
      widget.bookmarks ?? BookmarksController(MemoryKeyValueStore());

  final GlobalKey<ScaffoldMessengerState> _messenger =
      GlobalKey<ScaffoldMessengerState>();

  StreamSubscription<void>? _refusals;

  @override
  void initState() {
    super.initState();
    widget.links?.attach(_router, onUnrecognised: _linkNotRecognised);
    _refusals = widget.reminders?.permissionRefusals.listen(
      (_) => _messenger.currentState?.showSnackBar(
        SnackBar(
          content: Text(
            ReminderStrings.forLanguage(_settings.settings.language)
                .permissionRefused,
          ),
        ),
      ),
    );
  }

  /// Says that a link opened Today because the app has no page for it.
  void _linkNotRecognised() {
    WidgetsBinding.instance.addPostFrameCallback(
      (_) => _messenger.currentState?.showSnackBar(
        SnackBar(
          content: Text(
            ShareStrings(
              LectioLocalizations.forLanguage(_settings.settings.language.name),
            ).linkNotRecognised,
          ),
        ),
      ),
    );
  }

  @override
  void dispose() {
    unawaited(_refusals?.cancel());
    widget.links?.detach(_router);
    _router.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final reminders = widget.reminders;
    final app = SettingsScope(
      notifier: _settings,
      child: BookmarksScope(
        notifier: _bookmarks,
        child: ListenableBuilder(
          listenable: _settings,
          builder: (context, _) => MaterialApp.router(
            title: 'Lectio',
            locale: _settings.settings.language.locale,
            supportedLocales: supportedLocales,
            localizationsDelegates: lectioLocalizationsDelegates,
            scaffoldMessengerKey: _messenger,
            theme: buildLectioTheme(widget.colour, Brightness.light),
            darkTheme: buildLectioTheme(widget.colour, Brightness.dark),
            themeMode: _settings.settings.theme.mode,
            builder: applyTextSize,
            routerConfig: _router,
          ),
        ),
      ),
    );
    if (reminders == null) return app;
    return DailyReminderScope(scheduler: reminders, child: app);
  }
}
