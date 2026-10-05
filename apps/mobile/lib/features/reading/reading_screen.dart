import 'package:flutter/widgets.dart';
import 'package:go_router/go_router.dart';
import 'package:lectio/src/routing/app_route.dart';
import 'package:lectio/src/screens/placeholder_screen.dart';

/// The Reading tab. A placeholder until L-103 replaces this file.
class ReadingScreen extends StatelessWidget {
  /// Creates the Reading screen.
  const new({super.key});

  @override
  Widget build(BuildContext context) {
    return const PlaceholderScreen(route: AppRoute.reading);
  }
}

/// The Reading route inside the tab shell; its owner may add sub-routes.
GoRoute readingRoute() {
  return GoRoute(
    path: AppRoute.reading.path,
    name: AppRoute.reading.name,
    builder: (context, state) => const ReadingScreen(),
  );
}
