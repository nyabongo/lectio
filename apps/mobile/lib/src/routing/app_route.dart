import 'package:flutter/material.dart';
import 'package:lectio/l10n/lectio_localizations.dart';

/// A top-level destination of the app.
///
/// Today, Reading and Listen are the bottom tabs; Calendar and Settings sit
/// behind the header, as on the site.
enum AppRoute {
  /// The day's celebration and readings.
  today('/today', 'app_tabs_today', Icons.today_outlined),

  /// Commentary on one reading.
  reading('/reading', 'app_tabs_reading', Icons.menu_book_outlined),

  /// The audio commentary.
  listen('/listen', 'app_tabs_listen', Icons.headphones_outlined),

  /// The calendar and archive.
  calendar('/calendar', 'common_nav_calendar', Icons.calendar_month_outlined),

  /// Preferences.
  settings('/settings', 'common_nav_settings', Icons.settings_outlined);

  new(this.path, this.titleKey, this.icon);

  /// The location go_router matches, e.g. `/today`.
  final String path;

  /// The message key of the label shown in the header and navigation.
  final String titleKey;

  /// The label shown in the header and navigation, in [l10n]'s language.
  String titleIn(LectioLocalizations l10n) => l10n.text(titleKey);

  /// The label in the UI language of [context].
  String titleOf(BuildContext context) {
    return titleIn(LectioLocalizations.of(context));
  }

  /// The icon shown in the navigation or header.
  final IconData icon;

  /// The bottom-navigation tabs, in display order.
  static const List<AppRoute> tabs = [today, reading, listen];
}
