import 'package:go_router/go_router.dart';
import 'package:lectio/features/share/site_links.dart';

const String _date = r':date(\d{4}-\d{2}-\d{2})';
const String _slot = r':slot([a-z][a-z0-9-]*)';
const String _note = r':note([A-Za-z0-9_-]+)';

/// The site page paths the router accepts, under each locale prefix.
const List<String> _sitePaths = [
  '/$_date',
  '/$_date/$_slot',
  '/$_date/$_slot/notes/$_note',
];

/// Top-level routes for the site's page paths, relative to the site root:
/// `/2026-09-20`, `/2026-09-20/gospel` and `/2026-09-20/gospel/notes/<id>`,
/// also under a locale prefix (`/sw/2026-09-20`).
///
/// Each redirects to the app's page for it ([locationForSitePath]), so
/// `context.go('/2026-09-20/gospel/notes/v15-evil-eye')` opens that note.
/// Links from outside the app go through `DeepLinks`, which strips the
/// site's host and base path first. The router appends these routes after
/// the app's own, so `/today` and the others match first.
List<RouteBase> deepLinkRoutes() {
  return [
    for (final prefix in ['', for (final locale in siteLocales) '/$locale'])
      for (final path in _sitePaths)
        GoRoute(
          path: '$prefix$path',
          redirect: (context, state) =>
              locationForSitePath(state.uri.pathSegments),
        ),
  ];
}
