import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:lectio/src/routing/router.dart';
import 'package:lectio/src/theme/lectio_theme.dart';
import 'package:lectio/src/theme/liturgical_colour.dart';

/// The Lectio app: Material 3, tinted by the day's liturgical colour.
class LectioApp extends StatefulWidget {
  /// Creates the app with the accent for [colour], starting at
  /// [initialLocation].
  const LectioApp({
    super.key,
    this.colour = LiturgicalColour.green,
    this.initialLocation = '/today',
  });

  /// The liturgical colour that tints the accent.
  final LiturgicalColour colour;

  /// Where the router starts.
  final String initialLocation;

  @override
  State<LectioApp> createState() => _LectioAppState();
}

class _LectioAppState extends State<LectioApp> {
  late final GoRouter _router = createRouter(
    initialLocation: widget.initialLocation,
  );

  @override
  void dispose() {
    _router.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp.router(
      title: 'Lectio',
      theme: buildLectioTheme(widget.colour, Brightness.light),
      darkTheme: buildLectioTheme(widget.colour, Brightness.dark),
      routerConfig: _router,
    );
  }
}
