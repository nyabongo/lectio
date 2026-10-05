import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lectio/src/theme/lectio_theme.dart';
import 'package:lectio/src/theme/liturgical_colour.dart';

/// WCAG AA for every liturgical accent on every surface the app draws it on
/// (L-108): 4.5:1 for text, 3:1 for borders and other non-text marks.
void main() {
  for (final colour in LiturgicalColour.values) {
    for (final brightness in Brightness.values) {
      group('${colour.name} in ${brightness.name}', () {
        final scheme = buildLectioTheme(colour, brightness).colorScheme;
        // The page, cards (Material 3 cards use surfaceContainerLow) and the
        // offline notice.
        final surfaces = {
          'surface': scheme.surface,
          'card': scheme.surfaceContainerLow,
          'notice': scheme.surfaceContainerHighest,
        };

        for (final MapEntry(key: name, value: surface) in surfaces.entries) {
          test('accent text on the $name is at least 4.5:1', () {
            expect(
              contrastRatio(scheme.primary, surface),
              greaterThanOrEqualTo(4.5),
            );
          });

          test('muted text on the $name is at least 4.5:1', () {
            expect(
              contrastRatio(scheme.onSurfaceVariant, surface),
              greaterThanOrEqualTo(4.5),
            );
          });

          test('the swatch outline on the $name is at least 3:1', () {
            expect(
              contrastRatio(scheme.outline, surface),
              greaterThanOrEqualTo(3),
            );
          });
        }

        test('text on the accent is at least 4.5:1', () {
          expect(
            contrastRatio(scheme.onPrimary, scheme.primary),
            greaterThanOrEqualTo(4.5),
          );
        });

        test('selected chips and tabs are at least 4.5:1', () {
          expect(
            contrastRatio(
              scheme.onSecondaryContainer,
              scheme.secondaryContainer,
            ),
            greaterThanOrEqualTo(4.5),
          );
        });
      });
    }
  }
}
