import 'package:flutter/material.dart';
import 'package:lectio/l10n/lectio_localizations.dart';
import 'package:lectio/src/routing/app_route.dart';

/// Stand-in body for a route whose real screen is not built yet.
class PlaceholderScreen extends StatelessWidget {
  /// Creates a placeholder for [route].
  const new({required this.route, super.key});

  /// The route this placeholder stands in for.
  final AppRoute route;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final l10n = LectioLocalizations.of(context);
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(route.icon, size: 48, color: theme.colorScheme.primary),
          const SizedBox(height: 16),
          Text(route.titleIn(l10n), style: theme.textTheme.headlineSmall),
          const SizedBox(height: 8),
          Text(l10n.text('app_comingSoon')),
        ],
      ),
    );
  }
}
