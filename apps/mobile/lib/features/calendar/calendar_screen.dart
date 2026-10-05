import 'package:flutter/widgets.dart';
import 'package:go_router/go_router.dart';
import 'package:lectio/src/routing/app_route.dart';
import 'package:lectio/src/screens/placeholder_screen.dart';
import 'package:lectio/src/screens/standalone_scaffold.dart';

/// The calendar and archive, opened full screen from the header. A
/// placeholder until the issue that builds it replaces this file.
class CalendarScreen extends StatelessWidget {
  /// Creates the Calendar screen.
  const new({super.key});

  @override
  Widget build(BuildContext context) {
    return StandaloneScaffold(
      title: AppRoute.calendar.title,
      body: const PlaceholderScreen(route: AppRoute.calendar),
    );
  }
}

/// The Calendar route, outside the tab shell; its owner may add sub-routes.
GoRoute calendarRoute() {
  return GoRoute(
    path: AppRoute.calendar.path,
    name: AppRoute.calendar.name,
    builder: (context, state) => const CalendarScreen(),
  );
}
