import 'package:flutter/material.dart';

/// A top-level destination of the app.
///
/// Today, Reading and Listen are the bottom tabs; Calendar and Settings sit
/// behind the header, as on the site.
enum AppRoute {
  /// The day's celebration and readings.
  today('/today', 'Today', Icons.today_outlined),

  /// Commentary on one reading.
  reading('/reading', 'Reading', Icons.menu_book_outlined),

  /// The audio commentary.
  listen('/listen', 'Listen', Icons.headphones_outlined),

  /// The calendar and archive.
  calendar('/calendar', 'Calendar', Icons.calendar_month_outlined),

  /// Preferences.
  settings('/settings', 'Settings', Icons.settings_outlined);

  new(this.path, this.title, this.icon);

  /// The location go_router matches, e.g. `/today`.
  final String path;

  /// The label shown in the header and navigation.
  final String title;

  /// The icon shown in the navigation or header.
  final IconData icon;

  /// The bottom-navigation tabs, in display order.
  static const List<AppRoute> tabs = [today, reading, listen];
}
