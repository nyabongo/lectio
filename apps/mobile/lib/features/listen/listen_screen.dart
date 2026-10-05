import 'package:flutter/widgets.dart';
import 'package:go_router/go_router.dart';
import 'package:lectio/src/routing/app_route.dart';
import 'package:lectio/src/screens/placeholder_screen.dart';

/// The Listen tab. A placeholder until L-104 replaces this file.
class ListenScreen extends StatelessWidget {
  /// Creates the Listen screen.
  const new({super.key});

  @override
  Widget build(BuildContext context) {
    return const PlaceholderScreen(route: AppRoute.listen);
  }
}

/// The Listen route inside the tab shell; its owner may add sub-routes.
GoRoute listenRoute() {
  return GoRoute(
    path: AppRoute.listen.path,
    name: AppRoute.listen.name,
    builder: (context, state) => const ListenScreen(),
  );
}
