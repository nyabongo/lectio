import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:lectio/src/routing/app_route.dart';
import 'package:lectio/src/routing/app_shell.dart';
import 'package:lectio/src/screens/placeholder_screen.dart';

/// The tab whose path is [path], falling back to Today.
AppRoute tabForPath(String path) {
  for (final tab in AppRoute.tabs) {
    if (tab.path == path) return tab;
  }
  return AppRoute.today;
}

/// Builds the app's router, starting at [initialLocation].
///
/// `/` redirects to Today. The tabs share [AppShell]; Calendar and Settings
/// open full screen on top of it. Unknown locations show a not-found page.
GoRouter createRouter({String initialLocation = '/today'}) {
  return GoRouter(
    initialLocation: initialLocation,
    routes: [
      GoRoute(path: '/', redirect: (context, state) => AppRoute.today.path),
      ShellRoute(
        builder: (context, state, child) =>
            AppShell(current: tabForPath(state.uri.path), child: child),
        routes: [
          for (final tab in AppRoute.tabs)
            GoRoute(
              path: tab.path,
              name: tab.name,
              builder: (context, state) => PlaceholderScreen(route: tab),
            ),
        ],
      ),
      for (final route in [AppRoute.calendar, AppRoute.settings])
        GoRoute(
          path: route.path,
          name: route.name,
          builder: (context, state) => Scaffold(
            appBar: AppBar(title: Text(route.title)),
            body: PlaceholderScreen(route: route),
          ),
        ),
    ],
    errorBuilder: (context, state) => const NotFoundScreen(),
  );
}

/// Shown for a location that matches no route.
class NotFoundScreen extends StatelessWidget {
  /// Creates the not-found page.
  const NotFoundScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Not found')),
      body: Center(
        child: TextButton(
          onPressed: () => context.go(AppRoute.today.path),
          child: const Text('Go to Today'),
        ),
      ),
    );
  }
}
