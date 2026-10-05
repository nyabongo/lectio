import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:lectio/src/routing/app_route.dart';

/// Full-screen frame for routes outside the tab shell (Calendar, Settings).
///
/// Shows a back button when there is a page to go back to, and a Today action
/// otherwise, for example when the route was opened from a deep link.
class StandaloneScaffold extends StatelessWidget {
  /// Creates a full-screen frame titled [title] around [body].
  const new({required this.title, required this.body, super.key});

  /// The header title.
  final String title;

  /// The page content.
  final Widget body;

  @override
  Widget build(BuildContext context) {
    Widget? leading;
    if (!context.canPop()) {
      leading = IconButton(
        icon: Icon(AppRoute.today.icon),
        tooltip: AppRoute.today.title,
        onPressed: () => context.go(AppRoute.today.path),
      );
    }
    return Scaffold(
      appBar: AppBar(title: Text(title), leading: leading),
      body: body,
    );
  }
}
