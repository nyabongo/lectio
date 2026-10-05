import 'package:flutter/widgets.dart';
import 'package:go_router/go_router.dart';
import 'package:lectio/src/routing/app_route.dart';
import 'package:lectio/src/screens/placeholder_screen.dart';

/// The Today tab. A placeholder until L-102 replaces this file.
class TodayScreen extends StatelessWidget {
  /// Creates the Today screen.
  const new({super.key});

  @override
  Widget build(BuildContext context) {
    return const PlaceholderScreen(route: AppRoute.today);
  }
}

/// The Today route inside the tab shell; its owner may add sub-routes.
GoRoute todayRoute() {
  return GoRoute(
    path: AppRoute.today.path,
    name: AppRoute.today.name,
    builder: (context, state) => const TodayScreen(),
  );
}
