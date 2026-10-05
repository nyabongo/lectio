import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lectio/src/theme/lectio_theme.dart';
import 'package:lectio/src/theme/liturgical_colour.dart';

void main() {
  for (final colour in LiturgicalColour.values) {
    for (final brightness in Brightness.values) {
      test('${colour.name} ${brightness.name} theme uses the accent', () {
        final scheme = buildLectioTheme(colour, brightness).colorScheme;

        expect(scheme.brightness, brightness);
        expect(scheme.primary, colour.accent(brightness));
        expect(scheme.onPrimary, colour.onAccent(brightness));
        expect(
          contrastRatio(scheme.primary, scheme.surface),
          greaterThanOrEqualTo(4.5),
        );
      });
    }
  }
}
