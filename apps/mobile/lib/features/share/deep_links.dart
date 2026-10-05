import 'dart:async';

import 'package:go_router/go_router.dart';
import 'package:lectio/features/share/site_links.dart';

/// Opens the pages that links from outside the app ask for: site and
/// `lectio://` links (through app_links) and daily-reminder taps.
///
/// A link that arrives before the app's router exists (the link that
/// launched the app) is kept: the app starts there ([takeInitialLocation]).
/// Later ones go to the [attach]ed router.
class DeepLinks {
  /// Creates the handler for links to [site] (default: [siteBaseUrl]).
  new({Uri? site}) : _site = site ?? siteBaseUrl;

  final Uri _site;
  GoRouter? _router;
  String? _pending;

  /// The location asked for before a router was attached, once: the app
  /// starts there. `null` when there is none.
  String? takeInitialLocation() {
    final pending = _pending;
    _pending = null;
    return pending;
  }

  /// Sends later links to [router], and the one waiting, if any.
  void attach(GoRouter router) {
    _router = router;
    final pending = takeInitialLocation();
    if (pending != null) router.go(pending);
  }

  /// Stops sending links to [router], when it is the attached one.
  void detach(GoRouter router) {
    if (identical(_router, router)) _router = null;
  }

  /// Opens [link]; `false` (and nothing happens) when it is not a Lectio
  /// link (see [locationForLink]).
  bool openLink(Uri link) => _open(locationForLink(link, site: _site));

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
