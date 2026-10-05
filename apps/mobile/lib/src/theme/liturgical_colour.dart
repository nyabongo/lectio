import 'package:flutter/painting.dart';

/// The liturgical colour of a celebration, as `calendar/<year>.json` names it.
///
/// Each colour carries a contrast-safe accent pair for light and dark themes.
/// The values mirror the web design tokens (`data-colour` on the site, L-050);
/// change both together.
enum LiturgicalColour {
  /// Ordinary Time.
  green(light: Color(0xFF1E6B26), dark: Color(0xFF81C784)),

  /// Advent and Lent.
  violet(light: Color(0xFF5E2A84), dark: Color(0xFFC9A6E8)),

  /// Christmas, Easter and most feasts. White reads as a warm gilt accent,
  /// since a white accent would vanish on a light surface.
  white(light: Color(0xFF7A5C12), dark: Color(0xFFE6D3A3)),

  /// Passion, Pentecost, apostles and martyrs.
  red(light: Color(0xFFB3261E), dark: Color(0xFFF2B8B5)),

  /// Gaudete and Laetare Sundays.
  rose(light: Color(0xFFA63D66), dark: Color(0xFFF4AFC8)),

  /// Masses for the dead, where permitted.
  black(light: Color(0xFF262626), dark: Color(0xFFD6D6D6)),

  /// Solemnities, where gold may replace white.
  gold(light: Color(0xFF8A6100), dark: Color(0xFFF0C75E));

  const LiturgicalColour({required this.light, required this.dark});

  /// Accent on light surfaces; white text on it is at least 4.5:1.
  final Color light;

  /// Accent on dark surfaces; near-black text on it is at least 4.5:1.
  final Color dark;

  /// The accent for [brightness].
  Color accent(Brightness brightness) {
    if (brightness == Brightness.dark) return dark;
    return light;
  }

  /// Text and icon colour to place on [accent].
  Color onAccent(Brightness brightness) {
    if (brightness == Brightness.dark) return const Color(0xFF121212);
    return const Color(0xFFFFFFFF);
  }
}

/// The colour named [name] (case-insensitive), or green when it is unknown.
LiturgicalColour parseLiturgicalColour(String? name) {
  final key = name?.trim().toLowerCase();
  for (final colour in LiturgicalColour.values) {
    if (colour.name == key) return colour;
  }
  return LiturgicalColour.green;
}

/// WCAG 2.x contrast ratio between [a] and [b] (from 1 to 21).
double contrastRatio(Color a, Color b) {
  final la = a.computeLuminance();
  final lb = b.computeLuminance();
  final lighter = la > lb ? la : lb;
  final darker = la > lb ? lb : la;
  return (lighter + 0.05) / (darker + 0.05);
}
