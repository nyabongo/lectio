import 'package:flutter/widgets.dart';
import 'package:go_router/go_router.dart';
import 'package:lectio/src/routing/app_route.dart';
import 'package:lectio/src/screens/placeholder_screen.dart';
import 'package:lectio/src/screens/standalone_scaffold.dart';

/// Settings, opened full screen from the header. A placeholder until L-105
/// replaces this file.
class SettingsScreen extends StatelessWidget {
  /// Creates the Settings screen.
  const new({super.key});

  @override
  Widget build(BuildContext context) {
    return StandaloneScaffold(
      title: AppRoute.settings.title,
      body: const PlaceholderScreen(route: AppRoute.settings),
    );
  }
}

/// The Settings route, outside the tab shell; its owner may add sub-routes.
GoRoute settingsRoute() {
  return GoRoute(
    path: AppRoute.settings.path,
    name: AppRoute.settings.name,
    builder: (context, state) => const SettingsScreen(),
  );
}
