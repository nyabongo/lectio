import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lectio/src/theme/liturgical_colour.dart';

void main() {
  group('parseLiturgicalColour', () {
    test('reads calendar names case-insensitively', () {
      expect(parseLiturgicalColour('violet'), LiturgicalColour.violet);
      expect(parseLiturgicalColour(' ROSE '), LiturgicalColour.rose);
      expect(parseLiturgicalColour('Gold'), LiturgicalColour.gold);
    });

    test('falls back to green', () {
      expect(parseLiturgicalColour(null), LiturgicalColour.green);
      expect(parseLiturgicalColour('purple'), LiturgicalColour.green);
    });
  });

  group('accent pairs', () {
    for (final colour in LiturgicalColour.values) {
      for (final brightness in Brightness.values) {
        test('${colour.name} on ${brightness.name} is at least 4.5:1', () {
          final ratio = contrastRatio(
            colour.accent(brightness),
            colour.onAccent(brightness),
          );
          expect(ratio, greaterThanOrEqualTo(4.5));
        });
      }
    }

    test('accent picks the variant for the brightness', () {
      const colour = LiturgicalColour.red;
      expect(colour.accent(Brightness.light), colour.light);
      expect(colour.accent(Brightness.dark), colour.dark);
    });
  });

  group('contrastRatio', () {
    const black = Color(0xFF000000);
    const white = Color(0xFFFFFFFF);

    test('is 21 for black on white, in either order', () {
      expect(contrastRatio(black, white), closeTo(21, 0.01));
      expect(contrastRatio(white, black), closeTo(21, 0.01));
    });

    test('is 1 for a colour on itself', () {
      expect(contrastRatio(white, white), 1);
    });
  });
}
