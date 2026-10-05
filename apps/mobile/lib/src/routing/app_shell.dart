import 'dart:async';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:lectio/src/routing/app_route.dart';

/// The frame around the tab routes: a header with the current title and links
/// to Calendar and Settings, and a bottom bar for Today, Reading and Listen.
class AppShell extends StatelessWidget {
  /// Creates the shell showing [child] for the tab [current].
  const new({required this.current, required this.child, super.key});

  /// The tab being shown.
  final AppRoute current;

  /// The tab's content.
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(current.titleOf(context)),
        actions: [
          for (final route in [AppRoute.calendar, AppRoute.settings])
            IconButton(
              icon: Icon(route.icon),
              tooltip: route.titleOf(context),
              onPressed: () => unawaited(context.push(route.path)),
            ),
        ],
      ),
      body: child,
      bottomNavigationBar: NavigationBar(
        selectedIndex: AppRoute.tabs.indexOf(current),
        onDestinationSelected: (index) => context.go(AppRoute.tabs[index].path),
        destinations: [
          for (final tab in AppRoute.tabs)
            NavigationDestination(
              icon: Icon(tab.icon),
              label: tab.titleOf(context),
            ),
        ],
      ),
    );
  }
}
