import 'dart:async';

import 'package:go_router/go_router.dart';
import 'package:lectio/features/share/site_links.dart';
import 'package:lectio/src/routing/app_route.dart';

/// Opens the pages that links from outside the app ask for: site and
/// `lectio://` links (through app_links) and daily-reminder taps.
///
/// A link that arrives before the app's router exists (the link that
/// launched the app) is kept: the app starts there ([takeInitialLocation]).
/// Later ones go to the [attach]ed router.
///
/// A Lectio link the app has no page for (`/lectio/about/`, a date not on
/// the calendar) opens Today, and the app is told so it can say why.
class DeepLinks {
  /// Creates the handler for links to [site] (default: [siteBaseUrl]).
  new({Uri? site}) : _site = site ?? siteBaseUrl;

  final Uri _site;
  GoRouter? _router;
  String? _pending;
  void Function()? _onUnrecognised;
  bool _unrecognisedPending = false;

  /// The location asked for before a router was attached, once: the app
  /// starts there. `null` when there is none.
  String? takeInitialLocation() {
    final pending = _pending;
    _pending = null;
    return pending;
  }

  /// Sends later links to [router], and the one waiting, if any; calls
  /// [onUnrecognised] each time a link the app has no page for opened
  /// Today, including one that arrived before.
  void attach(GoRouter router, {void Function()? onUnrecognised}) {
    _router = router;
    _onUnrecognised = onUnrecognised;
    final pending = takeInitialLocation();
    if (pending != null) router.go(pending);
    if (_unrecognisedPending && onUnrecognised != null) {
      _unrecognisedPending = false;
      onUnrecognised();
    }
  }

  /// Stops sending links to [router], when it is the attached one.
  void detach(GoRouter router) {
    if (!identical(_router, router)) return;
    _router = null;
    _onUnrecognised = null;
  }

  /// Opens [link]; `false` (and nothing happens) when it is not a Lectio
  /// link ([sitePathOf]). A Lectio link the app has no page for
  /// ([locationForSitePath]) opens Today and reports it.
  bool openLink(Uri link) {
    final path = sitePathOf(link, site: _site);
    if (path == null) return false;
    final location = locationForSitePath(path);
    if (location != null) return _open(location);
    _open(AppRoute.today.path);
    final notify = _onUnrecognised;
    if (notify == null) {
      _unrecognisedPending = true;
    } else {
      notify();
    }
    return true;
  }

  /// Opens the day of a daily-reminder tap whose payload is [payload], the
  /// ISO date; `false` when it is not one.
  bool openReminder(String? payload) => _open(reminderLocation(payload));

  /// Opens each link [links] emits, as [openLink]; errors are ignored.
  StreamSubscription<Uri> listen(Stream<Uri> links) {
    return links.listen(openLink, onError: (_) {});
  }

  bool _open(String? location) {
    if (location == null) return false;
    final router = _router;
    if (router == null) {
      _pending = location;
    } else {
      router.go(location);
    }
    return true;
  }
}
