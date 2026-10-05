import 'package:flutter/material.dart';
import 'package:lectio/src/theme/liturgical_colour.dart';

/// The app theme for [brightness], tinted by the day's liturgical [colour].
///
/// The accent becomes the scheme's primary colour, so buttons, the selected
/// navigation destination and focus rings follow the liturgical season.
ThemeData buildLectioTheme(LiturgicalColour colour, Brightness brightness) {
  final accent = colour.accent(brightness);
  final seeded = ColorScheme.fromSeed(
    seedColor: accent,
    brightness: brightness,
  );
  final scheme = seeded.copyWith(
    primary: accent,
    onPrimary: colour.onAccent(brightness),
  );
  return ThemeData(colorScheme: scheme);
}
