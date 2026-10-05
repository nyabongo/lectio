import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:lectio/features/calendar/calendar_screen.dart';
import 'package:lectio/features/listen/listen_screen.dart';
import 'package:lectio/features/reading/reading_screen.dart';
import 'package:lectio/features/settings/settings_screen.dart';
import 'package:lectio/features/share/deep_link_routes.dart';
import 'package:lectio/features/today/today_screen.dart';
import 'package:lectio/l10n/lectio_localizations.dart';
import 'package:lectio/src/routing/app_route.dart';
import 'package:lectio/src/routing/app_shell.dart';

/// The tab whose path is [path] or a sub-path of it, falling back to Today.
AppRoute tabForPath(String path) {
  for (final tab in AppRoute.tabs) {
    if (path == tab.path || path.startsWith('${tab.path}/')) return tab;
  }
  return AppRoute.today;
}

/// Builds the app's router, starting at [initialLocation].
///
/// `/` redirects to Today. The tabs share [AppShell]; Calendar and Settings
/// open full screen on top of it; shared links come last. Each route lives in
/// its feature's file under `lib/features/`, so a feature issue replaces only
/// its own file. Unknown locations show a not-found page.
GoRouter createRouter({String initialLocation = '/today'}) {
  return GoRouter(
    initialLocation: initialLocation,
    routes: [
      GoRoute(path: '/', redirect: (context, state) => AppRoute.today.path),
      ShellRoute(
        builder: (context, state, child) =>
            AppShell(current: tabForPath(state.uri.path), child: child),
        routes: [todayRoute(), readingRoute(), listenRoute()],
      ),
      calendarRoute(),
      settingsRoute(),
      ...deepLinkRoutes(),
    ],
    errorBuilder: (context, state) => const NotFoundScreen(),
  );
}

/// Shown for a location that matches no route.
class NotFoundScreen extends StatelessWidget {
  /// Creates the not-found page.
  const new({super.key});

  @override
  Widget build(BuildContext context) {
    final l10n = LectioLocalizations.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(l10n.text('app_notFound_title'))),
      body: Center(
        child: TextButton(
          onPressed: () => context.go(AppRoute.today.path),
          child: Text(l10n.text('app_notFound_home')),
        ),
      ),
    );
  }
}
